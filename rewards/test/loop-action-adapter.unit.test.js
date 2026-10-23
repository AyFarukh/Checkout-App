import test from "node:test";
import assert from "node:assert/strict";
import {prepareLoopAdminAction} from "../src/services/loop-action-adapter.service.js";

test("skip next order uses documented endpoint",()=>{
  assert.deepEqual(prepareLoopAdminAction("skip","42347174",{}),{
    method:"POST",pathname:"subscription/42347174/skipNext",body:undefined
  });
});
test("order now requires explicit confirmation",()=>{
  assert.throws(()=>prepareLoopAdminAction("order-now","42347174",{}));
  assert.deepEqual(prepareLoopAdminAction("order-now","42347174",{preponeFutureOrder:true}).body,
    {preponeFutureOrder:true});
});
test("frequency uses documented policy contract",()=>{
  const p=prepareLoopAdminAction("frequency","42347174",{interval:"MONTH",intervalCount:2});
  assert.equal(p.method,"PUT");
  assert.equal(p.pathname,"subscription/42347174/frequency");
  assert.deepEqual(p.body,{billingPolicy:{interval:"MONTH",intervalCount:2},
    deliveryPolicy:{interval:"MONTH",intervalCount:2},discountType:"OLD"});
});
test("unknown actions and invalid identifiers fail closed",()=>{
  assert.throws(()=>prepareLoopAdminAction("cancel","42347174",{}));
  assert.throws(()=>prepareLoopAdminAction("skip","../other",{}));
  assert.throws(()=>prepareLoopAdminAction("frequency","42347174",{interval:"DAY",intervalCount:0}));
});

test("numeric subscription IDs are accepted and nonnumeric IDs rejected",()=>{
  assert.equal(prepareLoopAdminAction("skip","42347174").pathname,"subscription/42347174/skipNext");
  assert.throws(()=>prepareLoopAdminAction("skip","abc"));
});
