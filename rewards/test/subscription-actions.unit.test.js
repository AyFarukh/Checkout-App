import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/routes/welcomeVerification.js",import.meta.url),"utf8");
const start=src.indexOf('welcomeVerification.post("/subscriptions/action-execute"');
const end=src.indexOf('// Reschedule execution gate.',start);
const route=src.slice(start,end);
test("all twelve subscription action names are present",()=>{
  for(const action of ["skip","reschedule","delay","order-now","gift","frequency","pause","cancel","edit-products","edit-address","discount","order-note"])
    assert.ok(route.includes('"'+action+'"'),action);
});
test("all actions require signature, ownership and explicit confirmation",()=>{
  assert.match(route,/signed\(req\.query\)/);
  assert.match(route,/ShopifyOfflineToken\.exists/);
  assert.match(route,/getCustomerLoopSubscriptions/);
  assert.match(route,/req\.body\?\.confirm!==true/);
});
test("all action execution is fail closed",()=>{
  assert.match(route,/LOOP_ACTION_WRITE_NOT_READY/);
  assert.match(route,/applied:false/);
  assert.doesNotMatch(route,/fetch\(/);
  assert.doesNotMatch(route,/loopAdminRequest\(/);
});
