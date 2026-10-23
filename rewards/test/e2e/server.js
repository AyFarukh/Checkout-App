// Test-only Shopify proxy emulator, real Express routes, Mongo and HTTP Loop fixture.
import express from 'express';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startLoopFixture} from '../support/loop-fixture.js';
import {ShopifyOfflineToken} from '../../src/models/ShopifyOfflineToken.js';
import {LoopActionAttempt} from '../../src/models/LoopActionAttempt.js';
import {createSubscriptionActionRouter} from '../../src/routes/subscriptionActions.js';

const mongo=await MongoMemoryServer.create({instance:{args:['--nounixsocket']}});
await mongoose.connect(mongo.getUri());
await ShopifyOfflineToken.create({shop:'test.myshopify.com',accessToken:'fixture-only'});
const provider=await startLoopFixture();
Object.assign(process.env,{NODE_ENV:'test',LOOP_ALLOW_LOCAL_TEST_API:'true',LOOP_ADMIN_API_URL:provider.url,LOOP_ADMIN_REQUEST_HEADERS_JSON:'{"X-Loop-Token":"fixture-only"}',LOOP_TEST_SHOP:'test.myshopify.com',LOOP_TEST_CUSTOMER_ID:'123',LOOP_TEST_SUBSCRIPTION_ID:'42347174',LOOP_BILLING_TIMEZONE:'America/New_York',SHOPIFY_API_SECRET:'fixture-secret',LOOP_TEST_MUTATIONS_ENABLED:'true'});
const app=express();app.use(express.json());
app.get('/health',(_req,res)=>res.json({ok:true}));
app.get('/',(_req,res)=>res.type('html').send('<link rel="stylesheet" href="/dashboard.css"><section class="ftr-sub" id="ftr-subscription-dashboard-test" data-endpoint="/apps/ftr-welcome/subscriptions"><main class="ftr-sub__main"><div class="ftr-sub__loading"></div></main></section><script src="/dashboard.js"></script>'));
app.get('/dashboard.js',(_req,res)=>res.sendFile(process.env.FTR_THEME_ASSET||fileURLToPath(new URL('../../../../theme/assets/ftr-subscription-dashboard.js',import.meta.url))));
app.get('/dashboard.css',(_req,res)=>res.sendFile((process.env.FTR_THEME_ASSET||fileURLToPath(new URL('../../../../theme/assets/ftr-subscription-dashboard.js',import.meta.url))).replace(/\.js$/,'.css')));
app.get('/apps/ftr-welcome/subscriptions',(_req,res)=>res.json({ok:true,subscriptions:[provider.subscription]}));
app.use('/apps/ftr-welcome/subscriptions',(req,_res,next)=>{
 const url=new URL(req.url,'http://fixture');
 const q={shop:'test.myshopify.com',logged_in_customer_id:'123',timestamp:String(Math.floor(Date.now()/1000))};
 q.signature=createHmac('sha256','fixture-secret').update(Object.keys(q).sort().map(k=>`${k}=${q[k]}`).join('')).digest('hex');
 req.url=url.pathname+'?'+new URLSearchParams(q);next();
},createSubscriptionActionRouter());
app.post('/__fixture/reset',async(req,res)=>{provider.reset();if(req.body?.twoLines)provider.subscription.lineItems.push({id:9,quantity:1,productTitle:'Second product'});await LoopActionAttempt.deleteMany({});res.json({ok:true});});
app.get('/__fixture/state',async(_req,res)=>res.json({writes:provider.writes.length,attempts:await LoopActionAttempt.find({}).select('action status verifiedAt -_id')}));
const server=app.listen(4123,'127.0.0.1');
async function close(){await new Promise(r=>server.close(r));await provider.close();await mongoose.disconnect();await mongo.stop();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
