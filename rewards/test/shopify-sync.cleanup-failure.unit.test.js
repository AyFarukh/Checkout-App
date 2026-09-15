import test from "node:test";
import assert from "node:assert/strict";

/**
 * Mirrors the integration harness failure-composition contract without touching
 * Shopify or MongoDB. If the functional body fails and cleanup verification
 * also fails, callers must receive both errors rather than losing either one.
 */
export function composeIntegrationFailure(testFailure, cleanupErrors = []) {
  if (cleanupErrors.length) {
    const cleanupError = new AggregateError(
      cleanupErrors,
      `Integration cleanup verification failed (${cleanupErrors.length} assertion/error${cleanupErrors.length === 1 ? "" : "s"})`,
    );
    if (testFailure) {
      return new AggregateError(
        [testFailure, cleanupError],
        "Integration test and cleanup verification both failed",
      );
    }
    return cleanupError;
  }
  return testFailure || null;
}

test("FTR-SYNC-CLEANUP-001 reports original test failure and forced cleanup failure", () => {
  const originalFailure = new Error("FORCED_ORIGINAL_TEST_FAILURE");
  const cleanupFailure = new Error("FORCED_CLEANUP_FAILURE");

  const reported = composeIntegrationFailure(originalFailure, [cleanupFailure]);

  assert.ok(reported instanceof AggregateError);
  assert.equal(reported.message, "Integration test and cleanup verification both failed");
  assert.equal(reported.errors.length, 2);
  assert.equal(reported.errors[0], originalFailure, "original functional failure must be preserved");

  const cleanupAggregate = reported.errors[1];
  assert.ok(cleanupAggregate instanceof AggregateError);
  assert.match(cleanupAggregate.message, /Integration cleanup verification failed/);
  assert.equal(cleanupAggregate.errors.length, 1);
  assert.equal(cleanupAggregate.errors[0], cleanupFailure, "cleanup failure must be preserved");

  const messages = [
    reported.message,
    ...reported.errors.flatMap((error) => [
      error.message,
      ...(error instanceof AggregateError ? error.errors.map((nested) => nested.message) : []),
    ]),
  ];
  assert.ok(messages.includes("FORCED_ORIGINAL_TEST_FAILURE"));
  assert.ok(messages.includes("FORCED_CLEANUP_FAILURE"));
});

test("FTR-SYNC-CLEANUP-002 reports forced cleanup failure when functional body passed", () => {
  const cleanupFailure = new Error("FORCED_CLEANUP_ONLY_FAILURE");
  const reported = composeIntegrationFailure(null, [cleanupFailure]);

  assert.ok(reported instanceof AggregateError);
  assert.match(reported.message, /Integration cleanup verification failed/);
  assert.equal(reported.errors.length, 1);
  assert.equal(reported.errors[0], cleanupFailure);
});
