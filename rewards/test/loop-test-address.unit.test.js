import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAddressTestFixture} from '../src/services/loop-test-address.service.js';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const subscription={id:42347174,shippingAddress:{firstName:'Test',lastName:'User',address1:'1 Test Road',address2:'Unit 1',city:'London',countryCode:'GB',provinceCode:'ENG',zip:'TEST',phone:'+441234567890',company:null}};
test('address fixture preserves actual country, province and every field except address2',()=>{
 const s=structuredClone(subscription),{original,payload}=prepareAddressTestFixture(s);
 assert.deepEqual(s,subscription);assert.equal(original.countryCode,'GB');assert.equal(original.provinceCode,'ENG');
 assert.deepEqual(Object.keys(payload).filter(k=>payload[k]!==original[k]),['address2']);assert.equal(original.address2,'Unit 1');
});
test('address test marker always makes an intentional change',()=>{
 const {payload}=prepareAddressTestFixture({...subscription,shippingAddress:{...subscription.shippingAddress,address2:'FreeTheRoots integration test'}});
 assert.notEqual(payload.address2,'FreeTheRoots integration test');
});
test('fixture preparation rejects missing originals and out-of-scope subscriptions',()=>{
 for(const s of [{id:42347175,shippingAddress:subscription.shippingAddress},{id:42347174},{...subscription,shippingAddress:{}}])
  assert.throws(()=>prepareAddressTestFixture(s));
});
test('CLI preparation keeps private originals and refuses to overwrite a different backup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'loop-address-'));
 try{
  const fixture=join(dir,'fixtures.json'),shim=join(dir,'read-only-api.mjs');
  writeFileSync(fixture,JSON.stringify({'edit-address':{firstName:'REPLACE'},skip:{}}));
  const s={...subscription,customer:{shopifyId:123}};
  const installReadOnlyFixture=value=>writeFileSync(shim,`globalThis.fetch=async (url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Mutation forbidden');const data=String(url).includes('/customer/')?[${JSON.stringify(value)}]:${JSON.stringify(value)};return new Response(JSON.stringify({success:true,data}),{status:200});};`);
  installReadOnlyFixture(s);
  const run=()=>spawnSync(process.execPath,['--import',shim,resolve('scripts/test-loop-actions-live.js'),'--action','edit-address','--prepare-address-fixture'],{cwd:dir,encoding:'utf8',env:{...process.env,NODE_ENV:'test',LOOP_TEST_ENV_FILE:join(dir,'absent.env'),LOOP_ADMIN_API_URL:'https://api.loopsubscriptions.com/admin/2026-04',LOOP_TEST_SHOP:'test.myshopify.com',LOOP_TEST_CUSTOMER_ID:'123',LOOP_TEST_SUBSCRIPTION_ID:'42347174',MONGODB_URI:'mongodb://127.0.0.1:1/fixture_loop_test',MONGODB_DB_NAME:'fixture_loop_test',LOOP_ADMIN_REQUEST_HEADERS_JSON:'{"X-Loop-Token":"private-test-token"}',LOOP_LIVE_FIXTURES:fixture}});
  const first=run();assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/ADDRESS_FIXTURE_PREPARED/);
  assert.doesNotMatch(first.stdout+first.stderr,/private-test-token|1 Test Road|441234567890/);
  const prepared=JSON.parse(readFileSync(fixture,'utf8'));
  assert.equal(prepared['edit-address'].countryCode,'GB');assert.equal(prepared['edit-address'].provinceCode,'ENG');assert.deepEqual(prepared.skip,{});
  assert.equal(statSync(fixture).mode&0o777,0o600);
  const backup=join(dir,'.loop-original-address.json'),original=readFileSync(backup,'utf8');
  assert.equal(JSON.parse(original).address.address2,'Unit 1');assert.equal(statSync(backup).mode&0o777,0o600);
  installReadOnlyFixture({...s,shippingAddress:{...s.shippingAddress,address2:'different original'}});
  const second=run();assert.equal(second.status,1);assert.match(second.stderr,/ORIGINAL_ADDRESS_BACKUP_DIFFERS/);
  assert.equal(readFileSync(backup,'utf8'),original);assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')),prepared);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
