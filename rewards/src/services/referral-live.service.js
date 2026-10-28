import crypto from "node:crypto";
import mongoose from "mongoose";
import { ReferralProgram } from "../models/ReferralProgram.js";
import { ReferralAccount } from "../models/ReferralAccount.js";
import { ReferralClaim } from "../models/ReferralClaim.js";
import { ReferralEntitlement } from "../models/ReferralEntitlement.js";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { shopifyAdminGraphql } from "./shopify-admin.service.js";
import { createReferralDiscount, findReferralDiscount, setReferralDiscountActive } from "./referral-discount.service.js";
import { syncCustomerRewardsMirrorBestEffort } from "./shopify-customer-rewards-mirror.service.js";

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode, code: "REFERRAL_UNAVAILABLE" });
const cents = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const codeFor = (kind, id) => `FTR-${kind}-${crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 20).toUpperCase()}`;
const live = program => Boolean(program?.liveEnabled && process.env.REFERRALS_FUNCTION_V2_READY === "1");
let indexesReady;
function ensureIndexes() {
  if (!indexesReady) indexesReady = Promise.all([ReferralAccount.init(), ReferralClaim.init(), ReferralEntitlement.init(), RewardCustomer.init(), PointsTransaction.init()])
    .catch(error => { indexesReady = null; throw error; });
  return indexesReady;
}
function identity(shop, customerId) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) throw fail("Authenticated customer required", 401);
}
async function programFor(shop) { return ReferralProgram.findOne({ shop }).lean(); }
async function shopInfo(shop, graphql) {
  const result = await graphql(shop, `query ReferralShop { shop { currencyCode primaryDomain { url } } }`);
  const url = result?.shop?.primaryDomain?.url;
  if (!url || new URL(url).protocol !== "https:") throw fail("Store referral URL is unavailable");
  return { currencyCode: result.shop.currencyCode, url };
}
async function accountFor(shop, customerId) {
  try { return await ReferralAccount.findOneAndUpdate({ shop, customerId }, { $setOnInsert: { shop, customerId, code: crypto.randomBytes(12).toString("hex").toUpperCase() } }, { upsert: true, new: true }); }
  catch (error) { if (error.code !== 11000) throw error; return ReferralAccount.findOne({ shop, customerId }); }
}
function offerView(claim) { return claim?.discountId ? { discountCode: claim.discountCode, expiresAt: claim.expiresAt, status: claim.status, minimumSpend: claim.policy.minimumSpend } : null; }

export async function referralProfile({ shop, customerId }, { graphql = shopifyAdminGraphql, mirror = syncCustomerRewardsMirrorBestEffort } = {}) {
  identity(shop, customerId);
  await ensureIndexes();
  const program = await programFor(shop);
  const enabled = live(program);
  if (enabled) await refreshMilestones(shop, customerId, program, mirror);
  const [count, entitlements, friendOffer, customer] = await Promise.all([
    ReferralClaim.countDocuments({ shop, referrerId: customerId, status: "QUALIFIED" }),
    ReferralEntitlement.find({ shop, customerId }).lean(), ReferralClaim.findOne({ shop, friendId: customerId }).lean(),
    RewardCustomer.findOne({ shop, shopifyCustomerId: customerId }).select("referralDebt").lean(),
  ]);
  const profile = enabled ? await accountFor(shop, customerId) : null;
  const info = enabled ? await shopInfo(shop, graphql) : {};
  const byId = new Map(entitlements.map(item => [item.milestoneId, item]));
  const milestones = [...(program?.milestones || [])];
  for (const item of entitlements) if (!milestones.some(m => m.id === item.milestoneId)) milestones.push(item.snapshot);
  return { enabled, program: { friendDiscountAmount: program?.friendDiscountAmount || 10, referrerPoints: program?.referrerPoints || 200, currencyCode: info.currencyCode || "" },
    code: profile?.code || "", shareUrl: profile ? `${info.url}/apps/ftr-welcome/referrals?ref=${encodeURIComponent(profile.code)}` : "", qualifiedCount: count,
    referralDebt: customer?.referralDebt || 0, friendOffer: offerView(friendOffer),
    milestones: milestones.map(m => {
      const e = byId.get(m.id), snapshot = e?.snapshot || m;
      const used = ["CONSUMED", "REFUNDED"].includes(e?.status), expired = e?.expiresAt && e.expiresAt <= new Date();
      const status = snapshot.kind === "REFERRAL_POINTS" && count >= 1 ? "EARNED" : snapshot.kind === "POINTS" && e ? (e.settledPoints > 0 ? "EARNED" : "REVERSED") : expired && !used ? "EXPIRED" : e?.status || "LOCKED";
      return { ...snapshot, unlocked: e ? e.qualified : count >= m.threshold, entitlementId: e?._id, status,
        discountCode: e?.discountId && e?.qualified && !e.syncAction && !used && !expired ? e.discountCode : undefined, expiresAt: e?.expiresAt };
    }).sort((a, b) => a.threshold - b.threshold) };
}

// Only one merchant operation for a particular opaque record may be in flight.
// A lost Shopify response is recovered by deterministic code, never reminted.
async function issue(model, record, config, customerId, options) {
  if (record.discountId) return record;
  const lock = crypto.randomUUID(), now = new Date();
  const owned = await model.findOneAndUpdate({ _id: record._id, discountId: null,
    $or: [{ issueLockUntil: null }, { issueLockUntil: { $lt: now } }] },
  { $set: { issueLock: lock, issueLockUntil: new Date(Date.now() + 60_000) } }, { new: true });
  if (!owned) {
    const existing = await model.findById(record._id);
    if (existing?.discountId) return existing;
    throw fail("Your code is being prepared. Please retry shortly.");
  }
  try {
    const discount = await options.discountCreator({ shop: record.shop, code: record.discountCode, reference: String(record._id), customerId, config, expiresAt: record.expiresAt });
    const saved = await model.findOneAndUpdate({ _id: record._id, issueLock: lock }, { $set: { discountId: discount.discountId }, $unset: { issueLock: 1, issueLockUntil: 1 } }, { new: true });
    if (!saved) throw fail("Code preparation interrupted. Retry to recover the same code.");
    return saved;
  } catch (error) {
    await model.updateOne({ _id: record._id, issueLock: lock }, { $unset: { issueLock: 1, issueLockUntil: 1 } }); throw error;
  }
}

export async function claimFriendOffer({ shop, customerId, code }, { graphql = shopifyAdminGraphql, discountCreator = createReferralDiscount } = {}) {
  identity(shop, customerId);
  await ensureIndexes();
  const program = await programFor(shop);
  if (!live(program)) throw fail("Referrals are not available in this store.");
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-F0-9]{24}$/.test(normalized)) throw fail("Invalid referral code", 400);
  const referrer = await ReferralAccount.findOne({ shop, code: normalized }).lean();
  if (!referrer || referrer.customerId === customerId) throw fail("Use a friend's referral code, not your own.", 400);
  let claim = await ReferralClaim.findOne({ shop, friendId: customerId });
  if (claim && claim.referralCode !== normalized) throw fail("A referral has already been assigned to this account.");
  if (claim && (claim.expiresAt <= new Date() || claim.status !== "PENDING")) throw fail("This first-order offer has expired or has already been used.");
  const result = await graphql(shop, `query ReferralCustomer($id: ID!) { customer(id: $id) { id numberOfOrders } }`, { id: customerId });
  if (result?.customer?.id !== customerId || Number(result.customer.numberOfOrders) !== 0 || result.customer.numberOfOrders == null) throw fail("The referral discount is for your first order only.");
  if (!claim) {
    const id = new mongoose.Types.ObjectId();
    const policy = { revision: program.revision, points: program.referrerPoints, discountAmount: program.friendDiscountAmount,
      minimumSpend: Math.max(program.minimumOrderAmount || 0, program.friendDiscountAmount + 0.01) };
    try { claim = await ReferralClaim.create({ _id: id, shop, friendId: customerId, referrerId: referrer.customerId, referralCode: normalized,
      discountCode: codeFor("FRIEND", id), policy, expiresAt: new Date(Date.now() + program.attributionDays * 86400000) }); }
    catch (error) { if (error.code !== 11000) throw error; claim = await ReferralClaim.findOne({ shop, friendId: customerId }); }
    if (!claim || claim.referralCode !== normalized) throw fail("A referral has already been assigned to this account.");
  }
  claim = await issue(ReferralClaim, claim, { referralFirstOrder: true, type: "FIXED_DISCOUNT", discountValue: claim.policy.discountAmount,
    minimumSpend: claim.policy.minimumSpend }, customerId, { discountCreator });
  return offerView(claim);
}

// These mutations share the qualifying-order transaction; no ledger entry can
// exist without its claim/entitlement settlement, including concurrent webhooks.
async function pointDelta(account, delta, key, shop, orderId, metadata, session) {
  if (!delta) return;
  let points, debtCreated = 0, debtRecovered = 0;
  if (delta > 0) { debtRecovered = Math.min(account.referralDebt || 0, delta); account.referralDebt = (account.referralDebt || 0) - debtRecovered; points = delta; }
  else { points = -Math.min(account.pointsBalance, -delta); debtCreated = -delta + points; account.referralDebt = (account.referralDebt || 0) + debtCreated; }
  account.pointsBalance += points;
  if (delta > 0) account.lifetimeEarned += delta;
  await PointsTransaction.create([{ shop, shopifyCustomerId: account.shopifyCustomerId, type: delta > 0 ? "EARN" : "REFUND", points,
    balanceAfter: account.pointsBalance, source: "SHOPIFY_REFERRAL", reason: delta > 0 ? "Referral reward" : "Referral reward reversed after refund",
    shopifyOrderId: orderId, idempotencyKey: key, metadata: { ...metadata, debtCreated } }], { session });
  if (debtRecovered) {
    account.pointsBalance -= debtRecovered;
    await PointsTransaction.create([{ shop, shopifyCustomerId: account.shopifyCustomerId, type: "REFUND", points: -debtRecovered, balanceAfter: account.pointsBalance,
      source: "REFERRAL_DEBT_RECOVERY", reason: "Previously spent referral points recovered", idempotencyKey: `${key}:DEBT`, metadata: { debtRecovered } }], { session });
  }
}

async function settleMilestones(shop, owner, count, program, session, orderId) {
    const existing = await ReferralEntitlement.find({ shop, customerId: owner.shopifyCustomerId }).session(session);
    const byId = new Map(existing.map(e => [e.milestoneId, e]));
    for (const m of program?.milestones || []) {
      if (m.kind === "REFERRAL_POINTS" || count < m.threshold || byId.has(m.id) || (m.kind === "PRODUCT" && !m.variantId)) continue;
      const [entitlement] = await ReferralEntitlement.create([{ shop, customerId: owner.shopifyCustomerId, milestoneId: m.id, snapshot: m }], { session });
      existing.push(entitlement);
    }
    for (const e of existing) {
      const qualifies = count >= e.snapshot.threshold;
      if (e.snapshot.kind === "POINTS") {
        const target = qualifies ? e.snapshot.points : 0;
        if (target !== e.settledPoints) { e.settlementVersion++; await pointDelta(owner, target - e.settledPoints,
          `REFERRAL_MILESTONE:${e._id}:${e.settlementVersion}`, shop, orderId, { milestoneId: e.milestoneId }, session); e.settledPoints = target; }
      } else if (e.qualified !== qualifies && e.discountCode && !e.consumedOrderId) { e.syncAction = qualifies ? "ENABLE" : "DISABLE"; e.nextSyncAt = new Date(); }
      e.qualified = qualifies; await e.save({ session });
    }
}

async function refreshMilestones(shop, customerId, program, mirror) {
  if (!await ReferralClaim.exists({ shop, referrerId: customerId, status: "QUALIFIED" })) return;
  const session = await mongoose.startSession(); let changed;
  try { await session.withTransaction(async () => {
    const owner = await RewardCustomer.findOne({ shop, shopifyCustomerId: customerId }).session(session);
    if (!owner) return;
    const before = owner.pointsBalance;
    owner.referralVersion = (owner.referralVersion || 0) + 1;
    await owner.save({ session });
    const count = await ReferralClaim.countDocuments({ shop, referrerId: customerId, status: "QUALIFIED" }).session(session);
    await settleMilestones(shop, owner, count, program, session);
    await owner.save({ session });
    if (owner.pointsBalance !== before) changed = owner;
  }); } finally { await session.endSession(); }
  if (changed) await mirror({ shop, shopifyCustomerId: customerId, pointsBalance: changed.pointsBalance });
}

const ORDER_QUERY = `query ReferralOrder($id: ID!) {
  order(id: $id) {
    id createdAt cancelledAt displayFinancialStatus
    customer { id orders(first: 1, sortKey: CREATED_AT, reverse: false) { nodes { id } } }
    totalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } }
    discountApplications(first: 100) { nodes { ... on DiscountCodeApplication { code } } }
  }
}`;
export async function reconcileReferralOrder({ shop, orderId }, { graphql = shopifyAdminGraphql, mirror = syncCustomerRewardsMirrorBestEffort } = {}) {
  await ensureIndexes();
  const gid = String(orderId).startsWith("gid://shopify/Order/") ? String(orderId) : `gid://shopify/Order/${orderId}`;
  const source = (await graphql(shop, ORDER_QUERY, { id: gid }))?.order;
  if (!source) throw new Error("Referral order verification unavailable");
  const codes = (source.discountApplications?.nodes || []).map(n => String(n.code || "").toUpperCase());
  const customerId = source.customer?.id;
  const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(source.displayFinancialStatus);
  if (!paid || !customerId) return { skipped: true };
  // A milestone code can only consume its owner's entitlement once.
  await ReferralEntitlement.updateMany({ shop, customerId, discountCode: { $in: codes }, consumedOrderId: null },
    { $set: { status: "CONSUMED", consumedOrderId: gid, syncAction: null } });
  if (source.displayFinancialStatus === "REFUNDED") await ReferralEntitlement.updateMany({ shop, consumedOrderId: gid }, { $set: { status: "REFUNDED" } });
  const candidate = await ReferralClaim.findOne({ shop, friendId: customerId, discountCode: { $in: codes } }).lean();
  if (!candidate || (candidate.orderId && candidate.orderId !== gid)) return { skipped: true };
  if (source.customer.orders?.nodes?.[0]?.id !== gid) return { skipped: true, reason: "Not the first order" };
  const total = cents(source.totalPriceSet?.shopMoney?.amount), refunded = cents(source.totalRefundedSet?.shopMoney?.amount), subtotal = cents(source.subtotalPriceSet?.shopMoney?.amount);
  if (total == null || refunded == null || subtotal == null) throw new Error("Referral order amounts unavailable");
  const createdAt = new Date(source.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || createdAt < candidate.createdAt || createdAt > candidate.expiresAt || subtotal <= 0 || subtotal < cents(Math.max(0.01, candidate.policy.minimumSpend - candidate.policy.discountAmount))) return { skipped: true, reason: "Order is outside the offer eligibility window" };
  const program = await programFor(shop);
  try { await RewardCustomer.updateOne({ shop, shopifyCustomerId: candidate.referrerId }, { $setOnInsert: { shop, shopifyCustomerId: candidate.referrerId } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  const session = await mongoose.startSession();
  let owner;
  try { await session.withTransaction(async () => {
    const claim = await ReferralClaim.findById(candidate._id).session(session);
    if (claim.orderId && claim.orderId !== gid) return;
    const original = claim.originalCents ?? total;
    const refundedCents = Math.max(claim.refundedCents || 0, refunded, source.cancelledAt ? original : 0);
    const qualified = original > 0 && refundedCents < original;
    const desired = qualified ? Math.floor(claim.policy.points * Math.max(0, original - refundedCents) / original) : 0;
    owner = await RewardCustomer.findOne({ shop, shopifyCustomerId: claim.referrerId }).session(session);
    if (!owner) throw new Error("Referral wallet unavailable");
    // Always serialize on the referrer wallet, even when the point delta is zero.
    owner.referralVersion = (owner.referralVersion || 0) + 1;
    await owner.save({ session });
    if (desired !== claim.settledPoints) {
      claim.settlementVersion++;
      await pointDelta(owner, desired - claim.settledPoints, `REFERRAL:${claim._id}:${claim.settlementVersion}`, shop, gid, { claimId: String(claim._id) }, session);
    }
    claim.orderId = gid; claim.originalCents = original; claim.refundedCents = refundedCents; claim.settledPoints = desired; claim.status = qualified ? "QUALIFIED" : "REVOKED";
    await claim.save({ session });
    const count = await ReferralClaim.countDocuments({ shop, referrerId: claim.referrerId, status: "QUALIFIED" }).session(session);
    await settleMilestones(shop, owner, count, program, session, gid);
    await owner.save({ session });
  }); } finally { await session.endSession(); }
  if (owner) await mirror({ shop, shopifyCustomerId: owner.shopifyCustomerId, pointsBalance: owner.pointsBalance });
  return { processed: Boolean(owner) };
}

export async function claimReferralGift({ shop, customerId, milestoneId }, { graphql = shopifyAdminGraphql, discountCreator = createReferralDiscount } = {}) {
  identity(shop, customerId);
  await ensureIndexes();
  if (!live(await programFor(shop))) throw fail("Referral gifts are not available right now.");
  let e = await ReferralEntitlement.findOne({ shop, customerId, milestoneId, qualified: true });
  if (!e || e.snapshot.kind !== "PRODUCT" || e.consumedOrderId || e.syncAction) throw fail("This milestone gift is not available.");
  if (e.expiresAt && e.expiresAt <= new Date()) throw fail("This milestone gift code has expired.");
  const product = await graphql(shop, `query ReferralGiftAvailability($id: ID!) {
    node(id: $id) { ... on ProductVariant { id product { id status onlineStoreUrl } } }
  }`, { id: e.snapshot.variantId });
  if (product?.node?.id !== e.snapshot.variantId || product.node.product?.id !== e.snapshot.productId || product.node.product.status !== "ACTIVE") throw fail("This gift product is unavailable. Please contact the store.");
  const productUrl = product.node.product.onlineStoreUrl;
  if (!e.discountCode) e = await ReferralEntitlement.findOneAndUpdate({ _id: e._id, discountCode: null, qualified: true },
    { $set: { discountCode: codeFor("GIFT", e._id), expiresAt: new Date(Date.now() + 30 * 86400000) } }, { new: true }) || await ReferralEntitlement.findById(e._id);
  e = await issue(ReferralEntitlement, e, { referralGift: true, type: "FREE_PRODUCT", productId: e.snapshot.productId, variantId: e.snapshot.variantId,
    giftQuantity: e.snapshot.quantity, minimumSpend: 0 }, customerId, { discountCreator });
  if (!e.qualified) { await ReferralEntitlement.updateOne({ _id: e._id }, { $set: { syncAction: "DISABLE" } }); throw fail("Referral progress changed; this gift is no longer available."); }
  if (e.consumedOrderId) throw fail("This milestone gift has already been used.");
  await ReferralEntitlement.updateOne({ _id: e._id, qualified: true, consumedOrderId: null }, { $set: { status: "ISSUED" } });
  return { discountCode: e.discountCode, expiresAt: e.expiresAt, productTitle: e.snapshot.productTitle || e.snapshot.title, variantId: e.snapshot.variantId, quantity: e.snapshot.quantity, productUrl };
}

export async function processReferralMaintenance(limit = 20, { setActive = setReferralDiscountActive, findDiscount = findReferralDiscount } = {}) {
  await ensureIndexes();
  let processed = 0;
  while (processed < limit) {
    const now = new Date(), lock = crypto.randomUUID();
    const e = await ReferralEntitlement.findOneAndUpdate({ syncAction: { $in: ["ENABLE", "DISABLE"] },
      $and: [{ $or: [{ syncLockUntil: null }, { syncLockUntil: { $lt: now } }] },
        { $or: [{ issueLockUntil: null }, { issueLockUntil: { $lt: now } }] },
        { $or: [{ nextSyncAt: null }, { nextSyncAt: { $lte: now } }] }] },
    { $set: { syncLock: lock, syncLockUntil: new Date(Date.now() + 60_000) } }, { new: true });
    if (!e) break;
    try {
      let discountId = e.discountId;
      if (!discountId) {
        const recovered = await findDiscount({ shop: e.shop, code: e.discountCode, reference: String(e._id) });
        if (!recovered) throw new Error("Waiting for interrupted discount creation recovery");
        discountId = recovered.discountId;
        await ReferralEntitlement.updateOne({ _id: e._id, syncLock: lock }, { $set: { discountId } });
      }
      await setActive(e.shop, discountId, e.syncAction === "ENABLE");
      // A changed qualification or action remains queued. No other worker can
      // run an opposite mutation until this worker releases its external lease.
      await ReferralEntitlement.updateOne({ _id: e._id, syncLock: lock, syncAction: e.syncAction, qualified: e.qualified }, { $set: { syncAction: null } });
    } catch { await ReferralEntitlement.updateOne({ _id: e._id, syncLock: lock }, { $set: { nextSyncAt: new Date(Date.now() + 30_000) } }); }
    finally { await ReferralEntitlement.updateOne({ _id: e._id, syncLock: lock }, { $unset: { syncLock: 1, syncLockUntil: 1 } }); }
    processed++;
  }
  return processed;
}
