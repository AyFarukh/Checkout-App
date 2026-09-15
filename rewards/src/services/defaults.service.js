import { EarningRule } from "../models/EarningRule.js";
import { Reward } from "../models/Reward.js";
import { RewardSettings } from "../models/RewardSettings.js";

const DEFAULT_RULES = [
  { key: "purchase", name: "Place an order", type: "PURCHASE", enabled: true, points: 0, pointsPerDollar: 1, multiplier: 1, priority: 10, conditions: {} },
  { key: "account_create", name: "Create an account", type: "ACCOUNT_CREATE", enabled: true, points: 100, pointsPerDollar: 0, multiplier: 1, priority: 20, conditions: { oncePerCustomer: true } },
  { key: "birthday", name: "Birthday reward", type: "BIRTHDAY", enabled: false, points: 200, pointsPerDollar: 0, multiplier: 1, priority: 30, conditions: { oncePerYear: true } },
  { key: "review", name: "Write a review", type: "REVIEW", enabled: false, points: 150, pointsPerDollar: 0, multiplier: 1, priority: 40, conditions: { requiresIntegration: true } },
  { key: "referral", name: "Refer a friend", type: "REFERRAL", enabled: false, points: 500, pointsPerDollar: 0, multiplier: 1, priority: 50, conditions: { requiresIntegration: true, awardAfterReferredPurchase: true } },
  { key: "manual", name: "Manual points adjustment", type: "MANUAL", enabled: true, points: 0, pointsPerDollar: 0, multiplier: 1, priority: 60, conditions: { adminOnly: true } },
  { key: "bonus", name: "Bonus points campaign", type: "BONUS", enabled: false, points: 250, pointsPerDollar: 0, multiplier: 1, priority: 70, conditions: {} },
];

const DEFAULT_REWARDS = [
  { key: "five_off", name: "$5 off", type: "FIXED_DISCOUNT", enabled: true, pointsCost: 500, discountValue: 5, minimumSpend: 0, conditions: {} },
  { key: "ten_off", name: "$10 off", type: "FIXED_DISCOUNT", enabled: true, pointsCost: 900, discountValue: 10, minimumSpend: 0, conditions: {} },
  { key: "ten_percent", name: "10% off", type: "PERCENTAGE_DISCOUNT", enabled: true, pointsCost: 1000, discountValue: 10, minimumSpend: 0, conditions: {} },
  { key: "free_shipping", name: "Free shipping", type: "FREE_SHIPPING", enabled: true, pointsCost: 750, discountValue: 0, minimumSpend: 0, conditions: {} },
];

export async function ensureDefaultRewardsProgram(shop) {
  if (!shop) throw new Error("shop is required to seed rewards defaults");

  await RewardSettings.findOneAndUpdate(
    { shop },
    { $setOnInsert: { shop, pointNameSingular: "point", pointNamePlural: "points", pointsExpireEnabled: false, pointsExpireAfterDays: 365, refundPolicy: "REVERSE_PROPORTIONAL", allowDiscountCombinations: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  for (const rule of DEFAULT_RULES) {
    await EarningRule.findOneAndUpdate(
      { shop, "conditions.defaultKey": rule.key },
      { $setOnInsert: { ...rule, shop, conditions: { ...rule.conditions, defaultKey: rule.key, seeded: true } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  for (const reward of DEFAULT_REWARDS) {
    await Reward.findOneAndUpdate(
      { shop, "conditions.defaultKey": reward.key },
      { $setOnInsert: { ...reward, shop, conditions: { ...reward.conditions, defaultKey: reward.key, seeded: true } } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const [rules, rewards, settings] = await Promise.all([
    EarningRule.find({ shop }).sort({ priority: 1, createdAt: 1 }).lean(),
    Reward.find({ shop }).sort({ pointsCost: 1 }).lean(),
    RewardSettings.findOne({ shop }).lean(),
  ]);

  return { rules, rewards, settings };
}
