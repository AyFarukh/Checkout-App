/**
 * Standalone Node 22 app-proxy verifier. Mount /apps/ftr-welcome in Shopify app proxy.
 * Requires protected customer data approval, read_customers scope, Admin token,
 * and a first-order-only discount restriction enforced by Shopify.
 * This endpoint does not create/authorize discounts or collect marketing consent.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const { SHOPIFY_API_SECRET, SHOPIFY_ADMIN_TOKEN, SHOPIFY_SHOP_DOMAIN, PORT = '8080' } = process.env;
if (!SHOPIFY_API_SECRET || !SHOPIFY_ADMIN_TOKEN || !/^[a-z0-9-]+\.myshopify\.com$/.test(SHOPIFY_SHOP_DOMAIN || '')) {
  throw new Error('Missing SHOPIFY_API_SECRET, SHOPIFY_ADMIN_TOKEN, or valid SHOPIFY_SHOP_DOMAIN');
}
const buckets = new Map();
function verifyProxy(url) {
  const signature = url.searchParams.get('signature');
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const timestamp = Number(url.searchParams.get('timestamp'));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const pairs = [...url.searchParams.entries()].filter(([key]) => key !== 'signature');
  const keys = [...new Set(pairs.map(([key]) => key))].sort();
  const message = keys.map(key => key + '=' + pairs.filter(([k]) => k === key).map(([,v]) => v).join(',')).join('');
  const actual = createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest();
  return timingSafeEqual(actual, Buffer.from(signature, 'hex'));
}
function limited(key) {
  const now = Date.now();
  const item = buckets.get(key);
  if (!item || now - item.start > 60000) { buckets.set(key, {start:now, count:1}); return false; }
  return ++item.count > 5;
}
async function checkEmail(email) {
  const query = `query WelcomeCustomer($query: String!) { customers(first: 2, query: $query) { nodes { email numberOfOrders } } }`;
  const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2026-07/graphql.json`, {
    method: 'POST', headers: {'Content-Type':'application/json', 'X-Shopify-Access-Token':SHOPIFY_ADMIN_TOKEN},
    body: JSON.stringify({query,variables:{query:`email:"${email.replace(/["\\]/g, '')}"`}}), signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Shopify Admin API unavailable');
  const data = await response.json();
  if (data.errors || data.data?.customers?.nodes == null) throw new Error('Shopify query failed');
  const matches = data.data.customers.nodes.filter(customer => customer.email?.toLowerCase() === email.toLowerCase());
  return matches.length === 0 || matches.every(customer => Number(customer.numberOfOrders) === 0);
}
function json(res, status, payload) {
  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(payload));
}
createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return json(res,200,{ok:true});
  if (url.pathname !== '/apps/ftr-welcome' || req.method !== 'POST') return json(res,404,{error:'Not found'});
  if (!verifyProxy(url)) return json(res,403,{error:'Unauthorized'});
  const ip = (req.socket.remoteAddress || 'unknown');
  if (limited(ip)) return json(res,429,{error:'Please try later'});
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return json(res,413,{error:'Too large'}); }
  let email;
  try { email = JSON.parse(raw).email?.trim().toLowerCase(); } catch { return json(res,400,{error:'Invalid request'}); }
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res,400,{error:'Invalid email'});
  try { return json(res,200,{eligible:await checkEmail(email)}); }
  catch (error) { console.error('Welcome verification failed:', error.message); return json(res,503,{error:'Verification unavailable'}); }
}).listen(Number(PORT), () => console.log('Welcome verifier listening on',PORT));
