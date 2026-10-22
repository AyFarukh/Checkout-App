import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const route = readFileSync(new URL("../src/routes/welcomeVerification.js", import.meta.url), "utf8");
test("reschedule requires signed Shopify proxy", () => {
  assert.match(route, /if \(!signed\(req\.query\)\)/);
});
test("reschedule requires explicit confirmation", () => {
  assert.match(route, /req\.body\?\.confirm !== true/);
});
test("reschedule stays read-only", () => {
  const start = route.indexOf('welcomeVerification.post("/subscriptions/reschedule"');
  const end = route.indexOf('welcomeVerification.get("/subscriptions"', start);
  const handler = route.slice(start, end);
  assert.match(handler, /code:"LOOP_WRITE_NOT_READY"/);
  assert.match(handler, /applied:false/);
  assert.doesNotMatch(handler, /method:\s*"POST"\s*,\s*headers:\s*\{\s*Authorization/);
});
test("reschedule supports Loop next-order epoch and anchor guard", () => {
  assert.match(route, /subscription\.nextOrderDateEpoch \?\? subscription\.nextBillingDateEpoch/);
  assert.match(route, /LOOP_ANCHOR_REVIEW_REQUIRED/);
});
test("reschedule validates configured billing timezone", () => {
  assert.match(route, /Intl\.DateTimeFormat\("en-US",\{timeZone:timezone\}\)/);
});
