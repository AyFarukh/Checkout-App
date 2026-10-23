import test from "node:test";
import assert from "node:assert/strict";
import { actionRequestHash } from "../src/services/loop-action-ledger.service.js";

test("identical action requests produce the same request hash", () => {
  const request={shop:"example.myshopify.com",customerId:"6077104881725",subscriptionId:"42347174",action:"skip",payload:{}};
  assert.equal(actionRequestHash(request),actionRequestHash({...request}));
});
test("request hash binds subscription, customer, action and payload", () => {
  const request={shop:"example.myshopify.com",customerId:"6077104881725",subscriptionId:"42347174",action:"skip",payload:{}};
  const hash=actionRequestHash(request);
  assert.notEqual(hash,actionRequestHash({...request,subscriptionId:"42347175"}));
  assert.notEqual(hash,actionRequestHash({...request,customerId:"6077104881726"}));
  assert.notEqual(hash,actionRequestHash({...request,action:"cancel"}));
  assert.notEqual(hash,actionRequestHash({...request,payload:{reason:"customer"}}));
});
