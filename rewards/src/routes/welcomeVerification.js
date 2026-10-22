import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireDatabase } from "../config/db.js";
import { ShopifyOfflineToken } from "../models/ShopifyOfflineToken.js";
import { shopifyAdminGraphql } from "../services/shopify-admin.service.js";
import { getCustomerLoopSubscriptions } from "../services/loop-subscriptions.service.js";
import { enrichSubscriptionImages } from "../services/subscription-images.service.js";

export const welcomeVerification = Router();
const attempts = new Map();
export function signed(query) {
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
      // Returning offer requires a real Shopify customer with at least one order.
      if (!customers.some(x => Number(x.numberOfOrders) > 0)) return res.json({eligible:false});
      console.info("[Welcome verifier] Loop lookup starting", {mode, customerIdAvailable:Boolean(customers.find(x=>Number(x.numberOfOrders)>0)?.id)});
      const active = await hasActiveLoopSubscription(email);
      console.info("[Welcome verifier] Loop lookup completed", {active});
      return res.json({eligible:!active});
    }
    return res.json({eligible:customers.length===0 || customers.every(x=>Number(x.numberOfOrders)===0)});
  }catch(e){console.error("[Welcome verifier]",e.message);return res.status(503).json({error:"Verification unavailable"});}
});

 
// Storefront subscription dashboard: served through the EXISTING Shopify app proxy.
// Shopify signs logged_in_customer_id. Never accept customer IDs from the browser body.
// Test-only action validation. Never sends writes to Loop.
welcomeVerification.post("/subscriptions/action-preview", requireDatabase, async (req,res) => {
  res.set("Cache-Control","no-store");
  if (!signed(req.query)) return res.status(403).json({ok:false,message:"Invalid storefront signature."});
  const shop=String(req.query.shop||"").toLowerCase();
  const customerId=String(req.query.logged_in_customer_id||"");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d+$/.test(customerId))
    return res.status(401).json({ok:false,message:"Sign in required."});
  if (!await ShopifyOfflineToken.exists({shop})) return res.status(403).json({ok:false,message:"Store authorization required."});
  const allowCustomer=String(process.env.LOOP_TEST_CUSTOMER_ID||"");
  const allowSubscription=String(process.env.LOOP_TEST_SUBSCRIPTION_ID||"");
  if (!allowCustomer||!allowSubscription||customerId!==allowCustomer)
    return res.status(403).json({ok:false,message:"Only the configured test customer can preview subscription changes."});
  const action=String(req.body?.action||"");
  const supported=new Set(["skip","reschedule","delay","order-now","gift","frequency","pause","cancel","edit-products","edit-address","discount","order-note"]);
  if (!supported.has(action)) return res.status(400).json({ok:false,message:"Unsupported action."});
  const subscriptionId=String(req.body?.subscriptionId||"");
  if (subscriptionId!==allowSubscription) return res.status(403).json({ok:false,message:"Only the configured test subscription is allowed."});
  try {
    const subscriptions=await getCustomerLoopSubscriptions(customerId);
    if (!subscriptions.some(item=>[item.id,item.shopifyId,item.subscriptionId].some(id=>String(id||"")===subscriptionId)))
      return res.status(403).json({ok:false,message:"Subscription ownership could not be verified."});
    const payload=req.body?.payload;
    if (!payload||typeof payload!=="object"||Array.isArray(payload)||JSON.stringify(payload).length>2000)
      return res.status(400).json({ok:false,message:"Invalid action details."});
    if (action==="reschedule" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date||""))||Date.parse(payload.date)<Date.now()-86400000))
      return res.status(400).json({ok:false,message:"Select a valid future date."});
    if (action==="delay" && ![7,14,30].includes(Number(payload.days)))
      return res.status(400).json({ok:false,message:"Select 7, 14 or 30 days."});
    if (action==="frequency" && (![1,2,3,4,6].includes(Number(payload.intervalCount))||!["WEEK","MONTH"].includes(payload.interval)))
      return res.status(400).json({ok:false,message:"Invalid frequency."});
    return res.json({ok:true,preview:true,applied:false,message:"Action validated for test customer. No changes were sent to Loop.",action});
  }catch(error){console.error("[Subscription action preview]",error.message);return res.status(503).json({ok:false,message:"Unable to validate subscription ownership."});}
});

// Reschedule execution gate. Intentionally no Loop mutation until a verified
// Loop write-auth integration and its integration tests are available.
welcomeVerification.post("/subscriptions/reschedule", requireDatabase, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!signed(req.query)) return res.status(403).json({ok:false,message:"Invalid storefront signature."});
  // Presence-only diagnostics; never log customer IDs, signatures, or cookies.
  console.info("[Subscription reschedule auth]", {hasShop:Boolean(req.query.shop),hasCustomerId:Boolean(req.query.logged_in_customer_id),hasSignature:Boolean(req.query.signature),hasTimestamp:Boolean(req.query.timestamp)});
  const shop=String(req.query.shop||"").toLowerCase();
  const customerId=String(req.query.logged_in_customer_id||"");
  console.info("[Subscription reschedule auth validation]", {shopFormatValid:/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop),customerIdNumeric:/^\d+$/.test(customerId),customerIdLength:customerId.length,signatureValid:true});
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d+$/.test(customerId))
    return res.status(401).json({ok:false,message:"Sign in required."});
  if (!await ShopifyOfflineToken.exists({shop})) return res.status(403).json({ok:false,message:"Store authorization required."});
  const allowedCustomer=String(process.env.LOOP_TEST_CUSTOMER_ID||"");
  const allowedSubscription=String(process.env.LOOP_TEST_SUBSCRIPTION_ID||"");
  const subscriptionId=String(req.body?.subscriptionId||"");
  if (!allowedCustomer||!allowedSubscription||customerId!==allowedCustomer||subscriptionId!==allowedSubscription)
    return res.status(403).json({ok:false,message:"Only the configured test subscription is allowed."});
  if (req.body?.confirm !== true) return res.status(400).json({ok:false,message:"Explicit confirmation is required."});
  const requestedDate=String(req.body?.date||"");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return res.status(400).json({ok:false,message:"Invalid date."});
  const epoch=Date.parse(requestedDate+"T00:00:00Z");
  if (!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,10)!==requestedDate||epoch<Date.now()+86400000)
    return res.status(400).json({ok:false,message:"Choose a valid date at least 24 hours ahead."});
  try {
    const subscriptions=await getCustomerLoopSubscriptions(customerId);
    const subscription=subscriptions.find(item=>String(item.id)===subscriptionId&&String(item.status).toUpperCase()==="ACTIVE");
    if (!subscription) return res.status(403).json({ok:false,message:"Active subscription ownership could not be verified."});
    const previousEpoch=Number(subscription.nextBillingDateEpoch);
    if (!Number.isFinite(previousEpoch)||previousEpoch<=0) return res.status(409).json({ok:false,message:"Current billing date is unavailable."});
    if (new Date(previousEpoch*1000).toISOString().slice(0,10)===requestedDate)
      return res.status(409).json({ok:false,message:"The selected date is already scheduled."});
    // Rescheduling remains disabled until customer-scoped Loop authentication and
    // the storefront write request are independently verified in a test environment.
    if (process.env.LOOP_SUBSCRIPTION_MUTATIONS_ENABLED !== "true")
      return res.status(200).json({ok:false,applied:false,code:"LOOP_WRITE_DISABLED",message:"Reschedule validation passed, but actual Loop updates are disabled. No changes were made.",currentBillingDateEpoch:previousEpoch,requestedBillingDate:requestedDate});
    // SECURITY: Do not accept browser-supplied Loop tokens as proof of Shopify identity.
    // This route must remain read-only until a server-side verified token exchange,
    // durable idempotency and merchant-timezone semantics are implemented and tested.
    return res.status(200).json({
      ok:false,applied:false,code:"LOOP_WRITE_NOT_READY",
      message:"Reschedule preview passed. Secure Loop write integration is not yet available; no changes were made.",
      currentBillingDateEpoch:previousEpoch,requestedBillingDate:requestedDate
    });
  } catch(error) {
    console.error("[Subscription reschedule]",error.message);
    return res.status(503).json({ok:false,applied:false,message:"Unable to verify subscription. No changes were made."});
  }
});

welcomeVerification.get("/subscriptions", requireDatabase, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  if (!signed(req.query)) return res.status(403).json({ ok: false, message: "Invalid storefront signature." });
  const shop = String(req.query.shop || "").toLowerCase();
  const customerId = String(req.query.logged_in_customer_id || "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return res.status(403).json({ ok: false, message: "Invalid shop." });
  if (!/^\d+$/.test(customerId)) return res.status(401).json({ ok: false, message: "Please sign in to view your subscription." });
  try {
    if (!await ShopifyOfflineToken.exists({ shop })) return res.status(403).json({ ok: false, message: "Store authorization required." });
    const subscriptions = await getCustomerLoopSubscriptions(customerId);
    const enriched = await enrichSubscriptionImages(shop, subscriptions);
    return res.json({ ok: true, mode: "read-only", mutationsEnabled: false, subscriptions: enriched });
  } catch (error) {
    console.error("[Storefront subscriptions]", error.message);
    return res.status(503).json({ ok: false, message: "Subscription details are temporarily unavailable." });
  }
});
