import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import {connectDatabase} from '../src/config/db.js';
import {subscriberJourneyService,journeyConfig} from '../src/services/subscriber-journey.service.js';
import {SubscriberJourney} from '../src/models/SubscriberJourney.js';
const args=process.argv.slice(2),value=name=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
try{
 if(!journeyConfig().enabled)throw Error('JOURNEY_DISABLED');
 await connectDatabase();
 const shop=process.env.LOOP_ADMIN_SHOP||process.env.LOOP_TEST_SHOP;
 if(args.includes('--inspect')){
  const rows=await SubscriberJourney.find({shop,program:journeyConfig().program}).select('subscriptionId seedCount completedAt checkedAt issue -_id').limit(1000).lean();console.log(JSON.stringify({ok:true,records:rows},null,2));
 }else if(args.includes('--reconcile')){const batch=await subscriberJourneyService.processBatch();console.log(JSON.stringify({ok:!batch.disabled&&batch.failed===0,...batch}));if(batch.disabled||batch.failed)process.exitCode=1;}
 else{
  const filename=value('--file');if(!filename)throw Error('INPUT_FILE_REQUIRED');
  const rows=JSON.parse(await fs.readFile(filename,'utf8'));if(!Array.isArray(rows)||rows.length>10000)throw Error('INVALID_INPUT');
  const results=[];for(const row of rows){if(!/^[1-9]\d*$/.test(String(row.customerId))||!/^[1-9]\d*$/.test(String(row.subscriptionId)))throw Error('INVALID_INPUT');results.push(await subscriberJourneyService.enroll({shop,customerId:String(row.customerId)},String(row.subscriptionId),{apply:args.includes('--apply')}));}
  console.log(JSON.stringify({ok:true,dryRun:!args.includes('--apply'),results},null,2));
 }
}catch(e){console.error(JSON.stringify({ok:false,code:/^[A-Z_]+$/.test(e.code||e.message)?(e.code||e.message):'JOURNEY_COMMAND_FAILED'}));process.exitCode=1;}finally{await mongoose.disconnect();}
