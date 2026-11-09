import 'dotenv/config';
import mongoose from 'mongoose';
import {connectDatabase} from '../src/config/db.js';
import {setBundleTestRollout} from '../src/services/bundle-test-rollout.service.js';

const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
try{
 if(args.includes('--help')){
  console.log('node scripts/set-bundle-test-rollout.js --shop STORE.myshopify.com --transform-id gid://shopify/CartTransform/ID --enabled true|false');
 }else{
  const value=option('--enabled');
  if(!['true','false'].includes(value)||!option('--shop')||!option('--transform-id'))throw new Error('Use --help for the required arguments.');
  await connectDatabase();
  const result=await setBundleTestRollout({shop:option('--shop'),transformId:option('--transform-id'),enabled:value==='true'});
  console.log(JSON.stringify(result,null,2));
 }
}catch(error){
 console.error(JSON.stringify({ok:false,code:error.code||'BUNDLE_TEST_ROLLOUT_FAILED',message:error.message}));
 process.exitCode=1;
}finally{
 await mongoose.disconnect();
}
