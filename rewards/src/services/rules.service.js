import { EarningRule } from "../models/EarningRule.js";
import { RewardSettings } from "../models/RewardSettings.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { applyPointsTransaction } from "./rewards.service.js";

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export async function awardForAction({ shop, type, customer, eventId, amount = 0, source, shopifyOrderId, metadata = {} }) {
  if (!customer?.id) return { skipped: true, reason: "No customer attached to event" };

  const rules = await EarningRule.find({ shop, type, enabled: true }).sort({ priority: 1, createdAt: 1 }).lean();
  if (!rules.length) return { skipped: true, reason: `No enabled ${type} rule` };

  const results = [];
  for (const rule of rules) {
    const base = type === "PURCHASE" ? money(amount) * money(rule.pointsPerDollar) + money(rule.points) : money(rule.points);
    const points = Math.floor(base * money(rule.multiplier || 1));
    if (points <= 0) continue;

    results.push(await applyPointsTransaction({
      shop,
      shopifyCustomerId: String(customer.id),
      type: "EARN",
      points,
      source,
      reason: rule.name,
      shopifyOrderId,
      customer: { email: customer.email, firstName: customer.first_name, lastName: customer.last_name },
      idempotencyKey: `${source}:${eventId}:${rule._id}`,
      metadata: { ...metadata, ruleId: String(rule._id), ruleType: rule.type },
    }));
  }
  return { awarded: results.length, results };
}

export async function reverseForRefund({ shop, orderId, refundId, refundedAmount = 0 }) {
  const settings = await RewardSettings.findOne({ shop }).lean();
  if (settings?.refundPolicy === "NO_REVERSAL") return { skipped: true, reason: "Refund reversal disabled" };

  const earns = await PointsTransaction.find({ shop, shopifyOrderId: String(orderId), type: "EARN", source: "SHOPIFY_ORDER_PAID" }).lean();
  const results = [];
  for (const earn of earns) {
    let points = Math.abs(earn.points);
    if (settings?.refundPolicy !== "REVERSE_FULL") {
      const originalAmount = money(earn.metadata?.eligibleAmount);
      if (originalAmount > 0) points = Math.min(points, Math.ceil(points * Math.min(1, money(refundedAmount) / originalAmount)));
    }
    if (points <= 0) continue;
    results.push(await applyPointsTransaction({
      shop,
      shopifyCustomerId: earn.shopifyCustomerId,
      type: "REFUND",
      points,
      source: "SHOPIFY_REFUND",
      reason: "Points reversed after refund",
      shopifyOrderId: String(orderId),
      idempotencyKey: `SHOPIFY_REFUND:${refundId}:${earn._id}`,
      metadata: { refundId: String(refundId), originalTransactionId: String(earn._id), refundedAmount },
    }));
  }
  return { reversed: results.length, results };
}
