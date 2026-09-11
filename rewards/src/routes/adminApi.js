import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { RewardCustomer } from "../models/RewardCustomer.js";
import { PointsTransaction } from "../models/PointsTransaction.js";
import { EarningRule } from "../models/EarningRule.js";
import { Reward } from "../models/Reward.js";
import { RewardSettings } from "../models/RewardSettings.js";
import { applyPointsTransaction, getCustomerLedger } from "../services/rewards.service.js";

export const adminApi = Router();
adminApi.use(adminAuth);

adminApi.get("/dashboard", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    if (!shop) return res.status(400).json({ error: "shop is required" });

    const [members, aggregate, recent] = await Promise.all([
      RewardCustomer.countDocuments({ shop }),
      RewardCustomer.aggregate([
        { $match: { shop } },
        {
          $group: {
            _id: null,
            pointsOutstanding: { $sum: "$pointsBalance" },
            lifetimeEarned: { $sum: "$lifetimeEarned" },
            lifetimeRedeemed: { $sum: "$lifetimeRedeemed" },
          },
        },
      ]),
      PointsTransaction.find({ shop }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    res.json({
      members,
      pointsOutstanding: aggregate[0]?.pointsOutstanding || 0,
      lifetimeEarned: aggregate[0]?.lifetimeEarned || 0,
      lifetimeRedeemed: aggregate[0]?.lifetimeRedeemed || 0,
      recent,
    });
  } catch (error) {
    next(error);
  }
});

adminApi.get("/customers", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    const q = String(req.query.q || "").trim();
    if (!shop) return res.status(400).json({ error: "shop is required" });

    const filter = { shop };
    if (q) {
      filter.$or = [
        { email: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } },
        { shopifyCustomerId: { $regex: q, $options: "i" } },
      ];
    }

    const customers = await RewardCustomer.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ customers });
  } catch (error) {
    next(error);
  }
});

adminApi.get("/customers/:shopifyCustomerId", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    if (!shop) return res.status(400).json({ error: "shop is required" });
    res.json(await getCustomerLedger({ shop, shopifyCustomerId: req.params.shopifyCustomerId }));
  } catch (error) {
    next(error);
  }
});

adminApi.post("/customers/:shopifyCustomerId/adjust", async (req, res, next) => {
  try {
    const { shop, operation, points, reason, note, createdBy, customer } = req.body;
    const numericPoints = Number(points);
    if (!["ADD", "REMOVE"].includes(operation)) {
      return res.status(400).json({ error: "operation must be ADD or REMOVE" });
    }

    const result = await applyPointsTransaction({
      shop,
      shopifyCustomerId: req.params.shopifyCustomerId,
      type: operation === "ADD" ? "ADJUST" : "REDEEM",
      points: numericPoints,
      source: "ADMIN_ADJUSTMENT",
      reason,
      note,
      createdBy: createdBy || "admin",
      customer,
      idempotencyKey: `admin:${req.params.shopifyCustomerId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

adminApi.get("/activity", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    if (!shop) return res.status(400).json({ error: "shop is required" });
    const transactions = await PointsTransaction.find({ shop }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ transactions });
  } catch (error) {
    next(error);
  }
});

adminApi.get("/earning-rules", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    res.json({ rules: await EarningRule.find({ shop }).sort({ priority: 1, createdAt: 1 }).lean() });
  } catch (error) {
    next(error);
  }
});

adminApi.post("/earning-rules", async (req, res, next) => {
  try {
    const rule = await EarningRule.create(req.body);
    res.status(201).json({ rule });
  } catch (error) {
    next(error);
  }
});

adminApi.get("/rewards", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    res.json({ rewards: await Reward.find({ shop }).sort({ pointsCost: 1 }).lean() });
  } catch (error) {
    next(error);
  }
});

adminApi.post("/rewards", async (req, res, next) => {
  try {
    const reward = await Reward.create(req.body);
    res.status(201).json({ reward });
  } catch (error) {
    next(error);
  }
});

adminApi.get("/settings", async (req, res, next) => {
  try {
    const shop = String(req.query.shop || "").trim();
    const settings = await RewardSettings.findOneAndUpdate(
      { shop },
      { $setOnInsert: { shop } },
      { upsert: true, new: true }
    ).lean();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

adminApi.put("/settings", async (req, res, next) => {
  try {
    const { shop, ...updates } = req.body;
    const settings = await RewardSettings.findOneAndUpdate(
      { shop },
      { $set: updates, $setOnInsert: { shop } },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});
