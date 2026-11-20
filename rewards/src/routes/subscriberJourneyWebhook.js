import {Router} from 'express';
import {JourneySkip,SubscriberJourney} from '../models/SubscriberJourney.js';
import {verifyJourneySignature,journeyConfig,subscriberJourneyService} from '../services/subscriber-journey.service.js';
// Mounted with express.raw BEFORE the application's JSON parser.
export function createJourneyWebhookRouter(service=subscriberJourneyService){const router=Router();router.post('/',async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(!journeyConfig().enabled)return res.sendStatus(503);
 const keys=(process.env.LOOP_JOURNEY_WEBHOOK_SECRETS||'').split(',').filter(Boolean);
 if(!verifyJourneySignature(req.body,req.get('X-Loop-Webhook-Signature'),keys))return res.sendStatus(401);
 try{
  const body=JSON.parse(req.body.toString('utf8')),p=body.payload,shop=body.metaData?.myshopifyDomain;
  if(shop!==(process.env.LOOP_ADMIN_SHOP||process.env.LOOP_TEST_SHOP))return res.sendStatus(403);
  // Derive event type from the signed body. Delivery headers are not signed.
  if(body.metaData?.entity==='subscription'&&p?.status==='ACTIVE'&&/^[1-9]\d*$/.test(String(p.id))){await service.enrollFromEvent(shop,String(p.id));return res.sendStatus(200);}
  if(body.metaData?.entity==='order'&&p?.status==='PROCESSED'&&/^[1-9]\d*$/.test(String(p.subscriptionId))&&/^[1-9]\d*$/.test(String(p.id))){await service.enrollFromEvent(shop,String(p.subscriptionId),String(p.id));return res.sendStatus(200);}
  if(body.metaData?.entity!=='order'||p?.status!=='SKIPPED')return res.sendStatus(202);
  const subscriptionId=String(p.subscriptionId||''),orderId=String(p.id||'');
  if(!/^[1-9]\d*$/.test(subscriptionId)||!/^[1-9]\d*$/.test(orderId))return res.sendStatus(422);
  const occurredAt=new Date(p.skippedAt||p.updatedAt||''),valid=Number.isFinite(occurredAt.getTime())&&occurredAt.getTime()<=Date.now()+60000;
  await JourneySkip.init();
  try{await JourneySkip.create({shop,subscriptionId,key:'skip:'+orderId,...(valid?{occurredAt}:{issue:'JOURNEY_SKIP_REVIEW_REQUIRED'})});}catch(e){if(e.code!==11000)throw e;}
  if(!valid)await SubscriberJourney.updateMany({shop,subscriptionId},{$set:{issue:'JOURNEY_SKIP_REVIEW_REQUIRED'}});
  return res.sendStatus(200);
 }catch{return res.sendStatus(503);}
 });return router;}
