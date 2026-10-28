import {Router} from 'express';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {customerRewards} from './customerApi.js';
const publicDir=fileURLToPath(new URL('../../public/',import.meta.url));

export function rewardsProxy(verify){
 const router=Router();
 router.use((req,res,next)=>{
  res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');
  if(!verify(req.query))return res.status(403).json({error:'Invalid storefront signature'});
  const shop=String(req.query.shop||'').toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))return res.status(403).json({error:'Invalid shop'});
  req.storefrontShop=shop;next();
 });
 for(const file of ['rewards-customer.js','rewards-customer.css','referrals-customer.js','referrals-customer.css','ftr-logo.png','nunito-sans-400.ttf','nunito-sans-600.ttf','nunito-sans-700.ttf','nunito-sans-800.ttf','nunito-sans-OFL.txt']){
  router.get('/assets/'+file,(_req,res)=>res.sendFile(path.join(publicDir,file)));
 }
 router.get('/',(_req,res)=>res.sendFile(path.join(publicDir,'rewards-customer.html')));
 router.use('/api',(req,res,next)=>{
  // Identity is supplied only by Shopify's signed app proxy query, never body/headers.
  const id=String(req.query.logged_in_customer_id||'');
  if(!/^\d+$/.test(id))return res.status(401).json({error:'Sign in required'});
  if(req.method!=='GET'&&req.method!=='HEAD'){
   if(req.get('Sec-Fetch-Site')==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed'});
   if(!req.is('application/json'))return res.status(415).json({error:'JSON request required'});
  }
  req.customerSession={shop:req.storefrontShop,shopifyCustomerId:`gid://shopify/Customer/${id}`,numericCustomerId:id};next();
 },customerRewards);
 return router;
}
