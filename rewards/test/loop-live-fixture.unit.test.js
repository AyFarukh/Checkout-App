import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {addressFixturePlaceholderFields} from '../src/services/loop-action-contract.service.js';

test('live address placeholders are identified without returning their values',()=>{
 assert.deepEqual(addressFixturePlaceholderFields({firstName:'REPLACE',lastName:'YOUR_NAME',address1:'REPLACE_WITH_ADDRESS',city:'ACTUAL_CITY',company:'Replacement Parts'}),['firstName','lastName','address1','city']);
 assert.deepEqual(addressFixturePlaceholderFields({firstName:'Test',lastName:'User',address1:'1 Test Road',city:'Boston'}),[]);
});
test('live runner refuses sample addresses before database or provider access',()=>{
 const r=spawnSync(process.execPath,['scripts/test-loop-actions-live.js','--action','edit-address','--preview'],{
  encoding:'utf8',env:{...process.env,NODE_ENV:'test',LOOP_TEST_ENV_FILE:'/nonexistent-test-env',LOOP_ADMIN_API_URL:'https://api.loopsubscriptions.com/admin/2026-04',LOOP_TEST_SUBSCRIPTION_ID:'42347174',LOOP_TEST_SHOP:'test.myshopify.com',LOOP_TEST_CUSTOMER_ID:'123',MONGODB_URI:'mongodb://127.0.0.1:1/fixture_loop_test',MONGODB_DB_NAME:'fixture_loop_test',LOOP_LIVE_FIXTURES:'test/fixtures/loop-live-actions.example.json',LOOP_ADMIN_REQUEST_HEADERS_JSON:'{"X-Loop-Token":"must-not-print-secret"}'}
 });
 assert.equal(r.status,1);assert.match(r.stderr,/LIVE_FIXTURE_PLACEHOLDERS/);
 assert.doesNotMatch(r.stdout+r.stderr,/must-not-print-secret|Rewards DB|REPLACE/);
 const result=JSON.parse(r.stderr.trim().split('\n').at(-1));
 assert.deepEqual(result.fields,['firstName','lastName','address1','city']);
});
