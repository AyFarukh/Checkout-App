import {createHmac,timingSafeEqual} from 'node:crypto';
export function signed(query) {
  const secret=process.env.SHOPIFY_API_SECRET||process.env.SHOPIFY_API_SECRET_KEY;
  if(!secret||!query||Object.values(query).some(v=>typeof v!=='string'))return false;
  const sig=query.signature;
  if(typeof sig!=='string'||!/^[a-f0-9]{64}$/i.test(sig))return false;
  const timestamp=Number(query.timestamp);
  if(!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>300)return false;
  const message=Object.keys(query).filter(k=>k!=='signature').sort().map(k=>k+'='+query[k]).join('');
  return timingSafeEqual(createHmac('sha256',secret).update(message).digest(),Buffer.from(sig,'hex'));
}
export function subscriptionProxyAuth(req,res,next) {
  if(!signed(req.query))return res.status(403).json({ok:false,applied:false,code:'INVALID_SIGNATURE'});
  const shop=String(req.query.shop||'').toLowerCase(),customerId=String(req.query.logged_in_customer_id||'');
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d+$/.test(customerId))return res.status(401).json({ok:false,applied:false,code:'SIGN_IN_REQUIRED'});
  req.subscriptionIdentity={shop,customerId};next();
}
