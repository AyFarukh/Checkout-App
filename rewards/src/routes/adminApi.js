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

function shopFrom(req) {
  const shop = String(req.shopifySession?.shop || "").trim();
  if (!shop) { const error = new Error("Unable to resolve Shopify shop"); error.statusCode = 400; throw error; }
  return shop;
}
function editable(body, fields) { return Object.fromEntries(fields.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])); }

adminApi.get("/session", (req, res) => res.json({ shop: shopFrom(req), subject: req.shopifySession?.subject || "admin" }));
adminApi.get("/dashboard", async (req, res, next) => { try {
  const shop = shopFrom(req); const [members, aggregate, recent] = await Promise.all([
    RewardCustomer.countDocuments({ shop }),
    RewardCustomer.aggregate([{ $match: { shop } }, { $group: { _id: null, pointsOutstanding: { $sum: "$pointsBalance" }, lifetimeEarned: { $sum: "$lifetimeEarned" }, lifetimeRedeemed: { $sum: "$lifetimeRedeemed" } } }]),
    PointsTransaction.find({ shop }).sort({ createdAt: -1 }).limit(10).lean(),
  ]); res.json({ members, pointsOutstanding: aggregate[0]?.pointsOutstanding || 0, lifetimeEarned: aggregate[0]?.lifetimeEarned || 0, lifetimeRedeemed: aggregate[0]?.lifetimeRedeemed || 0, recent });
} catch (e) { next(e); } });

adminApi.get("/customers", async (req, res, next) => { try { const shop = shopFrom(req); const q = String(req.query.q || "").trim(); const filter = { shop }; if (q) filter.$or = ["email","firstName","lastName","shopifyCustomerId"].map((key) => ({ [key]: { $regex: q, $options: "i" } })); res.json({ customers: await RewardCustomer.find(filter).sort({ updatedAt: -1 }).limit(100).lean() }); } catch(e){next(e);} });
adminApi.get("/customers/:id", async (req,res,next)=>{try{res.json(await getCustomerLedger({shop:shopFrom(req),shopifyCustomerId:req.params.id}));}catch(e){next(e);}});
adminApi.post("/customers/:id/adjust", async (req,res,next)=>{try{ const {operation,points,reason,note,customer}=req.body; if(!["ADD","REMOVE"].includes(operation)) return res.status(400).json({error:"operation must be ADD or REMOVE"}); const amount=Math.abs(Number(points)); const result=await applyPointsTransaction({shop:shopFrom(req),shopifyCustomerId:req.params.id,type:"ADJUST",points:operation==="REMOVE"?-amount:amount,source:"ADMIN_ADJUSTMENT",reason,note,createdBy:req.shopifySession?.subject||"shopify-admin",customer,idempotencyKey:`admin:${req.params.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`}); res.status(201).json(result);}catch(e){next(e);}});
adminApi.get("/activity",async(req,res,next)=>{try{res.json({transactions:await PointsTransaction.find({shop:shopFrom(req)}).sort({createdAt:-1}).limit(200).lean()});}catch(e){next(e);}});

adminApi.get("/earning-rules",async(req,res,next)=>{try{res.json({rules:await EarningRule.find({shop:shopFrom(req)}).sort({priority:1,createdAt:1}).lean()});}catch(e){next(e);}});
adminApi.post("/earning-rules",async(req,res,next)=>{try{res.status(201).json({rule:await EarningRule.create({...req.body,shop:shopFrom(req)})});}catch(e){next(e);}});
adminApi.put("/earning-rules/:id",async(req,res,next)=>{try{const updates=editable(req.body,["name","type","enabled","points","pointsPerDollar","multiplier","priority","conditions"]);const rule=await EarningRule.findOneAndUpdate({_id:req.params.id,shop:shopFrom(req)},{$set:updates},{new:true,runValidators:true}).lean();if(!rule)return res.status(404).json({error:"Rule not found"});res.json({rule});}catch(e){next(e);}});
adminApi.delete("/earning-rules/:id",async(req,res,next)=>{try{const result=await EarningRule.deleteOne({_id:req.params.id,shop:shopFrom(req)});res.status(result.deletedCount?204:404).end();}catch(e){next(e);}});

adminApi.get("/rewards",async(req,res,next)=>{try{res.json({rewards:await Reward.find({shop:shopFrom(req)}).sort({pointsCost:1}).lean()});}catch(e){next(e);}});
adminApi.post("/rewards",async(req,res,next)=>{try{res.status(201).json({reward:await Reward.create({...req.body,shop:shopFrom(req)})});}catch(e){next(e);}});
adminApi.put("/rewards/:id",async(req,res,next)=>{try{const updates=editable(req.body,["name","type","enabled","pointsCost","discountValue","minimumSpend","productId","collectionId","conditions"]);const reward=await Reward.findOneAndUpdate({_id:req.params.id,shop:shopFrom(req)},{$set:updates},{new:true,runValidators:true}).lean();if(!reward)return res.status(404).json({error:"Reward not found"});res.json({reward});}catch(e){next(e);}});
adminApi.delete("/rewards/:id",async(req,res,next)=>{try{const result=await Reward.deleteOne({_id:req.params.id,shop:shopFrom(req)});res.status(result.deletedCount?204:404).end();}catch(e){next(e);}});

adminApi.get("/settings",async(req,res,next)=>{try{const shop=shopFrom(req);const settings=await RewardSettings.findOneAndUpdate({shop},{$setOnInsert:{shop}},{upsert:true,new:true}).lean();res.json({settings});}catch(e){next(e);}});
adminApi.put("/settings",async(req,res,next)=>{try{const shop=shopFrom(req);const updates=editable(req.body,["pointNameSingular","pointNamePlural","pointsExpireEnabled","pointsExpireAfterDays","earnOnTaxes","earnOnShipping","earnOnGiftCards","refundPolicy","allowDiscountCombinations"]);const settings=await RewardSettings.findOneAndUpdate({shop},{$set:updates,$setOnInsert:{shop}},{upsert:true,new:true,runValidators:true}).lean();res.json({settings});}catch(e){next(e);}});
