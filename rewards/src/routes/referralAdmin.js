import { Router } from "express";
import { ReferralProgram } from "../models/ReferralProgram.js";
import { AdminAuditLog } from "../models/AdminAuditLog.js";
import { defaultReferralProgram, normalizeReferralProgram } from "../services/referral-program.service.js";
import { shopifyAdminGraphql } from "../services/shopify-admin.service.js";

export const referralAdmin = Router();
function shopFrom(req) { return req.shopifySession.shop; }
function conflict() { return Object.assign(new Error("Referral settings changed in another session. Reload before saving."), { statusCode: 409, code: "REFERRAL_CONFIGURATION_CONFLICT" }); }

referralAdmin.get("/", async (req, res, next) => {
  try { res.json({ program: await ReferralProgram.findOne({ shop: shopFrom(req) }).lean() || defaultReferralProgram(), status: "DRAFT" }); }
  catch (error) { next(error); }
});

referralAdmin.put("/", async (req, res, next) => {
  try {
    const shop = shopFrom(req), program = normalizeReferralProgram(req.body);
    const revision = req.body.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw Object.assign(new Error("A valid configuration revision is required."), { statusCode: 400 });
    const selected = program.milestones.filter(m => m.variantId);
    if (selected.length) {
      const data = await shopifyAdminGraphql(shop, `query ReferralGiftVariants($ids: [ID!]!) {
        nodes(ids: $ids) { ... on ProductVariant { id title product { id title status } } }
      }`, { ids: [...new Set(selected.map(m => m.variantId))] });
      const variants = new Map((data?.nodes || []).filter(Boolean).map(v => [v.id, v]));
      for (const milestone of selected) {
        const variant = variants.get(milestone.variantId);
        if (!variant || variant.product?.id !== milestone.productId || variant.product?.status !== "ACTIVE") {
          throw Object.assign(new Error(`Select an active product and matching variant for “${milestone.title}”.`), { statusCode: 400, code: "REFERRAL_PRODUCT_UNAVAILABLE" });
        }
        milestone.productTitle = variant.product.title; milestone.variantTitle = variant.title;
      }
    }
    // Save and audit are atomic; a stale editor cannot overwrite a newer draft.
    const session = await ReferralProgram.startSession();
    let saved;
    try {
      await session.withTransaction(async () => {
        const before = await ReferralProgram.findOne({ shop }).session(session).lean();
        if ((before?.revision || 0) !== revision) throw conflict();
        saved = await ReferralProgram.findOneAndUpdate({ shop, revision }, { $set: program, $inc: { revision: 1 }, $setOnInsert: { shop } },
          { upsert: !before, new: true, runValidators: true, session }).lean();
        if (!saved) throw conflict();
        await AdminAuditLog.create([{ shop, actorId: req.shopifySession.subject, action: "REFERRAL_PROGRAM_UPDATED", resourceType: "ReferralProgram", resourceId: saved._id,
          requestId: req.requestId, before: before || defaultReferralProgram(), after: saved }], { session });
      });
    } catch (error) { if (error.code === 11000) throw conflict(); throw error; }
    finally { await session.endSession(); }
    res.json({ program: saved, status: "DRAFT" });
  } catch (error) { next(error); }
});
