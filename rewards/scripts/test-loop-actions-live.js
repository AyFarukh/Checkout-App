import 'dotenv/config';
import {config} from 'dotenv';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import mongoose from 'mongoose';
import {connectDatabase} from '../src/config/db.js';
import {ShopifyOfflineToken} from '../src/models/ShopifyOfflineToken.js';
import {loopActionService} from '../src/services/loop-action-executor.service.js';
import {ACTIONS,canonical,normalizeAction,addressFixturePlaceholderFields} from '../src/services/loop-action-contract.service.js';
import {getCustomerLoopSubscriptions,loopAdminRequest} from '../src/services/loop-subscriptions.service.js';

config({path:process.env.LOOP_TEST_ENV_FILE||'.env.loop-test',override:true});
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const stateFile=process.env.LOOP_LIVE_STATE_FILE||'.loop-live-state.json';
async function save(state){await writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
const safePrint=result=>console.log(JSON.stringify(Object.fromEntries(['ok','applied','verified','replayed','code','action','requestKey','message'].filter(k=>result[k]!==undefined).map(k=>[k,result[k]])),null,2));
async function main(){
 if(args.includes('--list')){for(const action of ACTIONS)console.log(action+(action==='gift'?' — BLOCKED: published gift-order API contract required':''));return;}
 if(!['test','development'].includes(process.env.NODE_ENV))throw Object.assign(Error(),{code:'USE_LOCAL_TEST_ENVIRONMENT'});
 if(process.env.LOOP_ADMIN_API_URL!=='https://api.loopsubscriptions.com/admin/2026-04')throw Object.assign(Error(),{code:'LIVE_LOOP_API_URL_REQUIRED'});
 if(process.env.LOOP_TEST_SUBSCRIPTION_ID!=='42347174'||!process.env.LOOP_TEST_CUSTOMER_ID||!process.env.LOOP_TEST_SHOP||!process.env.MONGODB_URI)throw Object.assign(Error(),{code:'TEST_CONFIGURATION_REQUIRED'});
 if(!/_loop_test$/.test(process.env.MONGODB_DB_NAME||''))throw Object.assign(Error(),{code:'DEDICATED_LOOP_TEST_DATABASE_REQUIRED'});
 const identity={shop:process.env.LOOP_TEST_SHOP,customerId:process.env.LOOP_TEST_CUSTOMER_ID};
 if(args.includes('--init-local-test')){
  const url=new URL(process.env.MONGODB_URI);
  if(!['127.0.0.1','localhost'].includes(url.hostname))throw Object.assign(Error(),{code:'LOCAL_DATABASE_REQUIRED'});
  await connectDatabase();
  await ShopifyOfflineToken.updateOne({shop:identity.shop},{$setOnInsert:{shop:identity.shop,accessToken:'local-loop-test-marker',scope:'local-loop-test-only'}},{upsert:true});
  console.log('Local test installation marker created. No Shopify or Loop changes were made.');return;
 }
 if(args.includes('--inspect')){
  const subscriptions=await getCustomerLoopSubscriptions(identity.customerId);
  if(!subscriptions.some(s=>String(s.id)==='42347174'))throw Object.assign(Error(),{code:'SUBSCRIPTION_NOT_OWNED'});
  const {data:s}=await loopAdminRequest('subscription/42347174');
  console.log(JSON.stringify({subscriptionId:s.id,status:s.status,nextBillingDateEpoch:s.nextOrderDateEpoch??s.nextBillingDateEpoch,billingPolicy:s.billingPolicy,lineItems:(s.lineItems||s.lines||[]).map(l=>({id:l.id,variantShopifyId:l.variantShopifyId,quantity:l.quantity})),hasShippingAddress:Boolean(s.shippingAddress)},null,2));return;
 }
 const action=option('--action');if(!ACTIONS.includes(action))throw Object.assign(Error(),{code:'SELECT_ONE_ACTION_WITH_ACTION_FLAG'});
 if(args.includes('--recover-invalid-address-fixture')){
  if(action!=='edit-address')throw Object.assign(Error(),{code:'INVALID_RECOVERY_ACTION'});
  if(!args.includes('--confirm-worker-stopped'))throw Object.assign(Error(),{code:'CONFIRM_WORKER_STOPPED_REQUIRED'});
  const url=new URL(process.env.MONGODB_URI);
  if(process.env.NODE_ENV!=='test'||!['127.0.0.1','localhost'].includes(url.hostname))throw Object.assign(Error(),{code:'LOCAL_TEST_RECOVERY_ONLY'});
  const state=JSON.parse(await readFile(stateFile,'utf8')),entry=state[action];
  if(!entry)throw Object.assign(Error(),{code:'REQUEST_NOT_FOUND_IN_LOCAL_STATE'});
  await connectDatabase();
  const result=await loopActionService.recoverInvalidAddressFixture(identity,{subscriptionId:'42347174',requestKey:entry.requestKey,confirmWorkerStopped:true});
  if(result.operationState==='rejected'){entry.status='rejected';await save(state);}
  safePrint(result);return;
 }
 if(args.includes('--status')){
  const state=JSON.parse(await readFile(stateFile,'utf8')),entry=state[action];if(!entry)throw Object.assign(Error(),{code:'REQUEST_NOT_FOUND_IN_LOCAL_STATE'});
  await connectDatabase();const result=await loopActionService.status(identity,{subscriptionId:'42347174',requestKey:entry.requestKey});
  entry.status=result.applied?'applied':result.operationState==='rejected'?'rejected':'unknown';await save(state);safePrint(result);if(!result.applied)process.exitCode=1;return;
 }
 const fixtures=JSON.parse(await readFile(process.env.LOOP_LIVE_FIXTURES||'test/fixtures/loop-live-actions.json','utf8'));
 const placeholders=action==='edit-address'?addressFixturePlaceholderFields(fixtures[action]):[];
 if(placeholders.length)throw Object.assign(Error(),{code:'LIVE_FIXTURE_PLACEHOLDERS',placeholderFields:placeholders});
 const payload=normalizeAction(action,fixtures[action]);
 if(!args.includes('--preview')&&!args.includes('--execute')&&!args.includes('--status'))throw Object.assign(Error(),{code:'USE_PREVIEW_EXECUTE_OR_STATUS'});
 let state={};try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 let entry=state[action];
 if(args.includes('--new')){
  if(entry&&!['applied','rejected'].includes(entry.status))throw Object.assign(Error(),{code:'RECONCILE_PREVIOUS_REQUEST_FIRST'});
  entry=null;
 }
 if(!entry){if(!args.includes('--preview'))throw Object.assign(Error(),{code:'PREVIEW_REQUIRED'});entry={requestKey:randomUUID(),status:'preview',payloadHash:canonical(payload)};state[action]=entry;}
 if(entry.payloadHash!==canonical(payload))throw Object.assign(Error(),{code:'PAYLOAD_CHANGED_USE_NEW_AFTER_RESOLUTION'});
 const body={action,payload,requestKey:entry.requestKey,subscriptionId:'42347174',confirm:true};
 await connectDatabase();
 if(args.includes('--preview')){
  if(entry.status!=='preview')throw Object.assign(Error(),{code:'REQUEST_ALREADY_SUBMITTED_CHECK_STATUS'});
  const result=await loopActionService.preview(identity,body);entry.previewToken=result.previewToken;await save(state);
  console.log(JSON.stringify({ok:true,action,requestKey:entry.requestKey,preview:true,expiresAt:result.expiresAt,requestedBillingDateEpoch:result.requestedBillingDateEpoch,billingTimezone:result.billingTimezone},null,2));return;
 }
 if(process.env.LOOP_LIVE_TEST_ACK!=='42347174')throw Object.assign(Error(),{code:'SET_LOOP_LIVE_TEST_ACK_TO_42347174'});
 // Save the key BEFORE dispatch; rerunning this command uses the same request.
 entry.status='unknown';await save(state);
 let result;
 try{result=await loopActionService.execute(identity,{...body,previewToken:entry.previewToken});}
 catch(error){if(error.dispatched===false){entry.status='rejected';await save(state);}throw error;}
 entry.status=result.applied?'applied':result.code==='LOOP_REJECTED'?'rejected':'unknown';await save(state);safePrint(result);if(!result.applied)process.exitCode=1;
}
try{await main();}catch(error){
 // Do not print raw provider errors, URIs, credentials, or customer information.
 console.error(JSON.stringify({ok:false,code:/^[A-Z][A-Z0-9_]+$/.test(error.code||'')?error.code:'LIVE_TEST_FAILED',...(error.code==='LIVE_FIXTURE_PLACEHOLDERS'?{fields:error.placeholderFields}:{}),message:'Test did not pass. Review the configuration and runbook; do not retry with a new request key while the outcome is unknown.'}));process.exitCode=1;
}finally{await mongoose.disconnect();}
