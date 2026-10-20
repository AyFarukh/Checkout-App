import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireDatabase } from "../config/db.js";
import { ShopifyOfflineToken } from "../models/ShopifyOfflineToken.js";
import { shopifyAdminGraphql } from "../services/shopify-admin.service.js";

export const welcomeVerification = Router();
const attempts = new Map();
function signed(query) {
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_KEY;
  const sig = query.signature;
  if (!secret || typeof sig !== "string" || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const timestamp = Number(query.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now()/1000 - timestamp) > 300) return false;
  const keys = Object.keys(query).filter(k => k !== "signature").sort();
  const message = keys.map(k => k + "=" + (Array.isArray(query[k]) ? query[k].join(",") : String(query[k]))).join("");
  const mac = createHmac("sha256",secret).update(message).digest();
  return timingSafeEqual(mac,Buffer.from(sig,"hex"));
}
welcomeVerification.post("/", requireDatabase, async (req,res) => {
  res.set("Cache-Control","no-store");
  if (!signed(req.query)) return res.status(403).json({error:"Unauthorized"});
  const key = req.ip || "unknown", now = Date.now(), bucket = attempts.get(key);
  if (bucket && now-bucket.start<60000 && bucket.count>=5) return res.status(429).json({error:"Try later"});
  attempts.set(key, !bucket || now-bucket.start>=60000 ? {start:now,count:1} : {start:bucket.start,count:bucket.count+1});
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Invalid email"});
  // Resolve the installed shop from the signed app proxy request, never from the email payload.
  const shop = String(req.query.shop || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$/.test(shop)) return res.status(403).json({error:"Invalid shop"});
  // Restrict lookups to stores already authorized in the Rewards token store.
  const installation = await ShopifyOfflineToken.exists({shop});
  if (!installation) return res.status(503).json({error:"Shop authorization required"});
  try {
    const query = `query($query:String!){customers(first:2,query:$query){nodes{email numberOfOrders}}}`;
    const data = await shopifyAdminGraphql(shop, query, {query:`email:"${email.replace(/["\\\\]/g,"")}"`});
    if (!Array.isArray(data?.customers?.nodes)) throw Error("Customer lookup unavailable");
    const customers=data.customers.nodes.filter(x=>x.email?.toLowerCase()===email);
    return res.json({eligible:customers.length===0 || customers.every(x=>Number(x.numberOfOrders)===0)});
  }catch(e){console.error("[Welcome verifier]",e.message);return res.status(503).json({error:"Verification unavailable"});}
});
