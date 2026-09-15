import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { SignJWT } from "jose";
import { WebhookEvent } from "../src/models/WebhookEvent.js";

const BASE_URL = process.env.REWARDS_ACCEPTANCE_BASE_URL || "http://127.0.0.1:3100";
const RESULT_DIR = process.env.REWARDS_ACCEPTANCE_RESULT_DIR || path.resolve("test-results");
const CONCURRENCY_RESULT_FILE = path.join(RESULT_DIR, "FTR-ADM-WH-011.json");
const API_KEY = process.env.SHOPIFY_API_KEY || "ftr-acceptance-api-key";
const API_SECRET = process.env.SHOPIFY_API_SECRET || "ftr-acceptance-api-secret-not-production";
const SHOP_A = "ftr-acceptance-a.myshopify.com";
const SHOP_B = "ftr-acceptance-b.myshopify.com";
const FIXTURE_PREFIX = `ftr-admin-acceptance-${process.pid}-${Date.now()}`;

let TOKEN_A;
let TOKEN_B;
let DEAD_EVENT_A;
let DEAD_EVENT_B;

async function sessionToken(shop, subject) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ dest: `https://${shop}`, sub: subject })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(`https://${shop}/admin`)
    .setAudience(API_KEY)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(API_SECRET));
}

async function seedFixtures() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "MONGODB_URI is required for admin acceptance tests");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || undefined });

  TOKEN_A = await sessionToken(SHOP_A, "acceptance-admin-a");
  TOKEN_B = await sessionToken(SHOP_B, "acceptance-admin-b");

  const [eventA, eventB] = await WebhookEvent.create([
    {
      shop: SHOP_A,
      webhookId: `${FIXTURE_PREFIX}-a`,
      topic: "orders/paid",
      status: "DEAD",
      payload: { acceptanceFixture: true, fixture: "A" },
      attempts: 5,
      deadAt: new Date(),
      lastError: "Acceptance fixture failure",
      lastErrorCode: "ACCEPTANCE_FIXTURE",
      failureReason: "MAX_ATTEMPTS",
      retryable: true,
      metadata: { acceptanceFixture: FIXTURE_PREFIX },
    },
    {
      shop: SHOP_A,
      webhookId: `${FIXTURE_PREFIX}-b`,
      topic: "orders/paid",
      status: "DEAD",
      payload: { acceptanceFixture: true, fixture: "B" },
      attempts: 5,
      deadAt: new Date(),
      lastError: "Acceptance fixture failure",
      lastErrorCode: "ACCEPTANCE_FIXTURE",
      failureReason: "MAX_ATTEMPTS",
      retryable: true,
      metadata: { acceptanceFixture: FIXTURE_PREFIX },
    },
  ]);

  DEAD_EVENT_A = String(eventA._id);
  DEAD_EVENT_B = String(eventB._id);
}

async function cleanupFixtures() {
  if (mongoose.connection.readyState) {
    await WebhookEvent.deleteMany({ "metadata.acceptanceFixture": FIXTURE_PREFIX });
    await mongoose.disconnect();
  }
}

function writeConcurrencyResult(payload) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(CONCURRENCY_RESULT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`FTR_MACHINE_RESULT=${JSON.stringify(payload)}`);
}

async function request(pathname, { token = TOKEN_A, method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
}

function assertErrorEnvelope(result, status, code) {
  assert.equal(result.response.status, status);
  assert.equal(result.json?.error?.code, code);
  assert.equal(typeof result.json?.error?.message, "string");
  assert.ok(result.json.error.message.length > 0);
  assert.equal(typeof result.json?.meta?.requestId, "string");
  assert.ok(result.json.meta.requestId.length > 0);
  assert.ok(!Number.isNaN(Date.parse(result.json?.meta?.timestamp)));
  assert.equal(result.json?.stack, undefined);
}

test("DEAD webhook admin acceptance", async (t) => {
  await seedFixtures();
  try {
    await t.test("FTR-ADM-WH-003 propagates a caller request ID through errors", async () => {
      const requestId = `acceptance-${Date.now()}`;
      const result = await request("/api/admin/webhooks/dead/not-an-object-id", { headers: { "X-Request-Id": requestId } });
      assertErrorEnvelope(result, 400, "INVALID_WEBHOOK_EVENT_ID");
      assert.equal(result.response.headers.get("x-request-id"), requestId);
      assert.equal(result.json.meta.requestId, requestId);
    });

    await t.test("FTR-ADM-WH-004 generates a request ID when none is supplied", async () => {
      const result = await request("/api/admin/webhooks/dead/not-an-object-id");
      assertErrorEnvelope(result, 400, "INVALID_WEBHOOK_EVENT_ID");
      const headerId = result.response.headers.get("x-request-id");
      assert.ok(headerId);
      assert.equal(result.json.meta.requestId, headerId);
    });

    await t.test("FTR-ADM-WH-002 uses the shared error envelope for invalid pagination", async () => {
      const result = await request("/api/admin/webhooks/dead?page=0");
      assertErrorEnvelope(result, 400, "INVALID_PAGE");
    });

    await t.test("FTR-ADM-WH-001 rejects an invalid webhook event ID", async () => {
      const result = await request("/api/admin/webhooks/dead/not-an-object-id");
      assertErrorEnvelope(result, 400, "INVALID_WEBHOOK_EVENT_ID");
    });

    await t.test("FTR-ADM-WH-005 exposes the owning tenant DEAD webhook", async () => {
      const own = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}`, { token: TOKEN_A });
      assert.equal(own.response.status, 200);
    });

    await t.test("FTR-ADM-WH-006 does not reveal another tenant's DEAD webhook", async () => {
      const crossTenant = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}`, { token: TOKEN_B });
      assertErrorEnvelope(crossTenant, 404, "WEBHOOK_EVENT_NOT_FOUND");
    });

    await t.test("FTR-ADM-WH-007 does not allow another tenant to retry a DEAD webhook", async () => {
      const result = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}/retry`, {
        token: TOKEN_B, method: "POST", headers: { "Idempotency-Key": `cross-tenant-${Date.now()}` }, body: {},
      });
      assertErrorEnvelope(result, 404, "WEBHOOK_EVENT_NOT_FOUND");
    });

    await t.test("FTR-ADM-WH-008 requires retry idempotency key", async () => {
      const result = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}/retry`, { method: "POST", body: {} });
      assertErrorEnvelope(result, 400, "IDEMPOTENCY_KEY_REQUIRED");
    });

    await t.test("FTR-ADM-WH-009 retries a DEAD webhook", async () => {
      const key = `retry-${Date.now()}`;
      const result = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}/retry`, {
        method: "POST", headers: { "Idempotency-Key": key }, body: {},
      });
      assert.equal(result.response.status, 202);
      assert.equal(result.json?.data?.status, "PENDING");
    });

    await WebhookEvent.updateOne({ _id: DEAD_EVENT_A }, { $set: { status: "DEAD", deadAt: new Date(), retryable: true } });

    await t.test("FTR-ADM-WH-010 replays an identical retry idempotently", async () => {
      const key = `retry-replay-${Date.now()}`;
      const options = { method: "POST", headers: { "Idempotency-Key": key }, body: {} };
      const first = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}/retry`, options);
      assert.equal(first.response.status, 202);
      assert.equal(first.json?.data?.status, "PENDING");
      const second = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}/retry`, options);
      assert.equal(second.response.status, 202);
      assert.equal(second.json?.meta?.idempotentReplay, true);
      assert.deepEqual(second.json?.data, first.json?.data);
    });

    await t.test("FTR-ADM-WH-011 only one concurrent retry performs the DEAD to PENDING transition", async () => {
      const requestPath = `/api/admin/webhooks/dead/${DEAD_EVENT_B}/retry`;
      const [a, b] = await Promise.all([
        request(requestPath, { method: "POST", headers: { "Idempotency-Key": `concurrent-a-${Date.now()}` }, body: {} }),
        request(requestPath, { method: "POST", headers: { "Idempotency-Key": `concurrent-b-${Date.now()}` }, body: {} }),
      ]);
      const responseStatuses = [a.response.status, b.response.status];
      const sortedStatuses = [...responseStatuses].sort((x, y) => x - y);
      const duplicateAccepted = responseStatuses[0] === 202 && responseStatuses[1] === 202;
      const passed = !duplicateAccepted && sortedStatuses[0] === 202 && sortedStatuses[1] === 409;
      const result = { testId: "FTR-ADM-WH-011", responseStatuses, sortedStatuses, duplicateAccepted, expectedStatuses: [202, 409], result: passed ? "PASS" : "FAIL", generatedAt: new Date().toISOString() };
      writeConcurrencyResult(result);
      assert.equal(duplicateAccepted, false, "FTR-ADM-WH-011 FAIL: concurrent retries returned 202 + 202");
      assert.deepEqual(sortedStatuses, [202, 409], `FTR-ADM-WH-011 FAIL: expected exactly 202 + 409; received ${sortedStatuses.join(" + ")}`);
      const conflict = a.response.status === 409 ? a : b;
      assert.ok(["WEBHOOK_STATE_CHANGED", "WEBHOOK_NOT_RETRYABLE"].includes(conflict.json?.error?.code));
      assert.equal(typeof conflict.json?.meta?.requestId, "string");
    });

    await t.test("FTR-ADM-WH-012 does not expose stack traces in admin errors", async () => {
      const result = await request("/api/admin/webhooks/dead/not-an-object-id");
      assertErrorEnvelope(result, 400, "INVALID_WEBHOOK_EVENT_ID");
      assert.equal(result.json?.stack, undefined);
    });
  } finally {
    await cleanupFixtures();
  }
});
