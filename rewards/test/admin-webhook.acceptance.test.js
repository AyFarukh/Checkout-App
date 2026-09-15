import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.REWARDS_ACCEPTANCE_BASE_URL || "http://127.0.0.1:3100";
const TOKEN_A = process.env.REWARDS_ACCEPTANCE_ADMIN_TOKEN_A;
const TOKEN_B = process.env.REWARDS_ACCEPTANCE_ADMIN_TOKEN_B;
const DEAD_EVENT_A = process.env.REWARDS_ACCEPTANCE_DEAD_EVENT_A;
const DEAD_EVENT_B = process.env.REWARDS_ACCEPTANCE_DEAD_EVENT_B;
const RESULT_DIR = process.env.REWARDS_ACCEPTANCE_RESULT_DIR || path.resolve("test-results");
const CONCURRENCY_RESULT_FILE = path.join(RESULT_DIR, "FTR-ADM-WH-011.json");

function requireFixture(name, value) {
  if (!value) throw new Error(`${name} is required for admin acceptance tests`);
  return value;
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
  requireFixture("REWARDS_ACCEPTANCE_ADMIN_TOKEN_A", TOKEN_A);
  requireFixture("REWARDS_ACCEPTANCE_ADMIN_TOKEN_B", TOKEN_B);
  requireFixture("REWARDS_ACCEPTANCE_DEAD_EVENT_A", DEAD_EVENT_A);
  requireFixture("REWARDS_ACCEPTANCE_DEAD_EVENT_B", DEAD_EVENT_B);

  await t.test("propagates a caller request ID through errors", async () => {
    const requestId = `acceptance-${Date.now()}`;
    const result = await request("/api/admin/webhooks/dead/not-an-object-id", {
      headers: { "X-Request-Id": requestId },
    });
    assertErrorEnvelope(result, 400, "INVALID_WEBHOOK_EVENT_ID");
    assert.equal(result.response.headers.get("x-request-id"), requestId);
    assert.equal(result.json.meta.requestId, requestId);
  });

  await t.test("generates a request ID when none is supplied", async () => {
    const result = await request("/api/admin/webhooks/dead/not-an-object-id");
    assertErrorEnvelope(result, 400, "INVALID_WEBHOOK_EVENT_ID");
    const headerId = result.response.headers.get("x-request-id");
    assert.ok(headerId);
    assert.equal(result.json.meta.requestId, headerId);
  });

  await t.test("uses the shared error envelope for invalid pagination", async () => {
    const result = await request("/api/admin/webhooks/dead?page=0");
    assertErrorEnvelope(result, 400, "INVALID_PAGE");
  });

  await t.test("does not reveal another tenant's DEAD webhook", async () => {
    const own = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}`, { token: TOKEN_A });
    assert.equal(own.response.status, 200);

    const crossTenant = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}`, { token: TOKEN_B });
    assertErrorEnvelope(crossTenant, 404, "WEBHOOK_EVENT_NOT_FOUND");
  });

  await t.test("does not allow another tenant to retry a DEAD webhook", async () => {
    const result = await request(`/api/admin/webhooks/dead/${DEAD_EVENT_A}/retry`, {
      token: TOKEN_B,
      method: "POST",
      headers: { "Idempotency-Key": `cross-tenant-${Date.now()}` },
      body: {},
    });
    assertErrorEnvelope(result, 404, "WEBHOOK_EVENT_NOT_FOUND");
  });

  await t.test("replays an identical retry idempotently", async () => {
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
    const keyA = `concurrent-a-${Date.now()}`;
    const keyB = `concurrent-b-${Date.now()}`;
    const requestPath = `/api/admin/webhooks/dead/${DEAD_EVENT_B}/retry`;
    const [a, b] = await Promise.all([
      request(requestPath, { method: "POST", headers: { "Idempotency-Key": keyA }, body: {} }),
      request(requestPath, { method: "POST", headers: { "Idempotency-Key": keyB }, body: {} }),
    ]);

    const responseStatuses = [a.response.status, b.response.status];
    const sortedStatuses = [...responseStatuses].sort((x, y) => x - y);
    const duplicateAccepted = responseStatuses[0] === 202 && responseStatuses[1] === 202;
    const passed = !duplicateAccepted && sortedStatuses[0] === 202 && sortedStatuses[1] === 409;
    const result = {
      testId: "FTR-ADM-WH-011",
      responseStatuses,
      sortedStatuses,
      duplicateAccepted,
      expectedStatuses: [202, 409],
      result: passed ? "PASS" : "FAIL",
      generatedAt: new Date().toISOString(),
    };
    writeConcurrencyResult(result);

    assert.equal(
      duplicateAccepted,
      false,
      `FTR-ADM-WH-011 FAIL: concurrent retries returned 202 + 202`,
    );
    assert.deepEqual(
      sortedStatuses,
      [202, 409],
      `FTR-ADM-WH-011 FAIL: expected exactly 202 + 409; received ${sortedStatuses.join(" + ")}`,
    );

    const conflict = a.response.status === 409 ? a : b;
    assert.ok(["WEBHOOK_STATE_CHANGED", "WEBHOOK_NOT_RETRYABLE"].includes(conflict.json?.error?.code));
    assert.equal(typeof conflict.json?.meta?.requestId, "string");
  });
});
