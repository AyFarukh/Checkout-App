import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

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
welcomeVerification.post("/", async (req,res) => {
  res.set("Cache-Control","no-store");
  if (!signed(req.query)) return res.status(403).json({error:"Unauthorized"});
  const key = req.ip || "unknown", now = Date.now(), bucket = attempts.get(key);
  if (bucket && now-bucket.start<60000 && bucket.count>=5) return res.status(429).json({error:"Try later"});
  attempts.set(key, !bucket || now-bucket.start>=60000 ? {start:now,count:1} : {start:bucket.start,count:bucket.count+1});
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Invalid email"});
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/.test(shop) || !token) return res.status(503).json({error:"Verification unavailable"});
  try {
    const query = `query($query:String!){customers(first:2,query:$query){nodes{email numberOfOrders}}}`;
    const result = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`,{
      method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token},
      body:JSON.stringify({query,variables:{query:`email:"${email.replace(/["\\]/g,"")}"`}}),
      signal:AbortSignal.timeout(8000)
    });
    if(!result.ok) throw Error("Admin API status "+result.status);
    const body=await result.json();
    if(body.errors || !Array.isArray(body.data?.customers?.nodes)) throw Error("GraphQL failed");
    const customers=body.data.customers.nodes.filter(x=>x.email?.toLowerCase()===email);
    return res.json({eligible:customers.length===0 || customers.every(x=>Number(x.numberOfOrders)===0)});
  }catch(e){console.error("[Welcome verifier]",e.message);return res.status(503).json({error:"Verification unavailable"});}
});
