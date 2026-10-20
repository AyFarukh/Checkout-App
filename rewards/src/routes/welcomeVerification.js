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

const LOOP_API_BASE = "https://api.loopsubscriptions.com/admin/2026-04";
async function hasActiveLoopSubscription(email) {
  const rawHeaders = process.env.LOOP_ADMIN_REQUEST_HEADERS_JSON;
  if (!rawHeaders) throw new Error("Loop Admin credentials not configured");
  let headers;
  try { headers = JSON.parse(rawHeaders); } catch { throw new Error("Invalid Loop Admin headers configuration"); }
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw new Error("Invalid Loop Admin headers");
  // Credentials stay on the server. Do not forward caller-controlled headers.
  const tokenHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === "x-loop-token");
  if (!tokenHeader || !String(tokenHeader[1] || "").trim()) throw new Error("Loop Admin X-Loop-Token missing");
  const response = await fetch(LOOP_API_BASE + "/customer/" + encodeURIComponent(email) + "/subscription", {
    headers: { "Accept": "application/json", "X-Loop-Token": String(tokenHeader[1]) },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("Loop subscription lookup HTTP " + response.status);
  const payload = await response.json();
  if (payload?.success === false) throw new Error("Loop subscription lookup failed");
  const records = Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.data?.subscriptions) ? payload.data.subscriptions :
    Array.isArray(payload?.subscriptions) ? payload.subscriptions : null;
  if (!records) throw new Error("Unexpected Loop subscriptions response");
  return records.some(item => String(item?.status || "").toUpperCase() === "ACTIVE");
}

welcomeVerification.post("/", requireDatabase, async (req,res) => {
  res.set("Cache-Control","no-store");
  if (!signed(req.query)) return res.status(403).json({error:"Unauthorized"});
  const key = req.ip || "unknown", now = Date.now(), bucket = attempts.get(key);
  if (bucket && now-bucket.start<60000 && bucket.count>=5) return res.status(429).json({error:"Try later"});
  attempts.set(key, !bucket || now-bucket.start>=60000 ? {start:now,count:1} : {start:bucket.start,count:bucket.count+1});
  const mode = req.body?.mode === "returning_subscription" ? "returning_subscription" : "first_order";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Invalid email"});
  // Resolve the installed shop from the signed app proxy request, never from the email payload.
  const shop = String(req.query.shop || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return res.status(403).json({error:"Invalid shop"});
  // Restrict lookups to stores already authorized in the Rewards token store.
  const installation = await ShopifyOfflineToken.exists({shop});
  if (!installation) return res.status(503).json({error:"Shop authorization required"});
  try {
    const query = `query($query:String!){customers(first:20,query:$query){nodes{id email numberOfOrders}}}`;
    const data = await shopifyAdminGraphql(shop, query, {query:`email:"${email.replace(/["\\\\]/g,"")}"`});
    if (!Array.isArray(data?.customers?.nodes)) throw Error("Customer lookup unavailable");
    const customers=data.customers.nodes.filter(x=>x.email?.trim().toLowerCase()===email);
    console.info("[Welcome verifier] customer lookup", {mode, returned:data.customers.nodes.length, exactMatches:customers.length, hasPreviousOrder:customers.some(x=>Number(x.numberOfOrders)>0)});
    if (mode === "returning_subscription") {
      // New emails and customers with zero orders can enter the new-subscriber offer.
      // For customers with previous orders, check Loop and reject active subscribers.
      // This is popup display eligibility only; discount redemption requires independent enforcement.
      if (!customers.some(x => Number(x.numberOfOrders) > 0)) {
        console.info("[Welcome verifier] new subscriber offer", {mode, reason:"no_previous_orders"});
        return res.json({eligible:true});
      }
      console.info("[Welcome verifier] Loop lookup starting", {mode, customerIdAvailable:Boolean(customers.find(x=>Number(x.numberOfOrders)>0)?.id)});
      const active = await hasActiveLoopSubscription(email);
      console.info("[Welcome verifier] Loop lookup completed", {active});
      return res.json({eligible:!active});
    }
    return res.json({eligible:customers.length===0 || customers.every(x=>Number(x.numberOfOrders)===0)});
  }catch(e){console.error("[Welcome verifier]",e.message);return res.status(503).json({error:"Verification unavailable"});}
});

/**
 * Read-only Shopify app-proxy action validation.
 * Shopify signs the proxy query and provides logged_in_customer_id.
 * No Loop write endpoint is called here.
 */
welcomeVerification.post("/subscriptions/action-preview", requireDatabase, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!signed(req.query)) return res.status(403).json({ok:false,message:"Invalid or expired Shopify app-proxy signature."});
  const shop = String(req.query.shop || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$/.test(shop)) return res.status(403).json({ok:false,message:"Invalid shop."});
  const customerId = String(req.query.logged_in_customer_id || "");
  if (!/^[0-9]+$/.test(customerId)) return res.status(401).json({ok:false,message:"Please sign in to your customer account."});
  const subscriptionId = String(req.body?.subscriptionId || "");
  const action = String(req.body?.action || "");
  const payload = req.body?.payload || {};
  if (!/^[0-9]+$/.test(subscriptionId)) return res.status(400).json({ok:false,message:"Invalid subscription."});
  const allowed = new Set(["order-now","skip","reschedule","delay","frequency","pause","cancel","edit-products","edit-address","gift","order-notes","discount","scheduled-orders","past-orders","payment-method","backup-payment-method"]);
  if (!allowed.has(action)) return res.status(400).json({ok:false,message:"This action is not supported."});
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return res.status(400).json({ok:false,message:"Invalid action details."});
  if (action === "reschedule") {
    const value = String(payload.date || "");
    const parsed = new Date(value + "T00:00:00Z");
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value || parsed.getTime() <= Date.now() - 86400000) {
      return res.status(400).json({ok:false,message:"Choose a valid future date."});
    }
  }
  try {
    if (!await ShopifyOfflineToken.exists({shop})) return res.status(503).json({ok:false,message:"Shop authorization required."});
    const { getCustomerLoopSubscriptions } = await import("../services/loop-subscriptions.service.js");
    const subscriptions = await getCustomerLoopSubscriptions(customerId);
    const owned = subscriptions.some(item => String(item?.id) === subscriptionId || String(item?.subscriptionId) === subscriptionId || String(item?.shopifyId) === subscriptionId);
    if (!owned) return res.status(403).json({ok:false,message:"Subscription not found for this customer."});
    return res.json({ok:true,validated:true,mutated:false,message:"Preview validated. No subscription changes were made."});
  } catch (error) {
    console.error("[Subscription action preview]",error?.message);
    return res.status(503).json({ok:false,message:"Subscription validation is temporarily unavailable."});
  }
});
