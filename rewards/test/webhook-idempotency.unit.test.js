import test from "node:test";
import assert from "node:assert/strict";
import { WebhookEvent } from "../src/models/WebhookEvent.js";

/**
 * These tests document the two independent idempotency barriers used by rewards:
 * 1. ingress: Shopify webhook identity is unique per shop;
 * 2. ledger: business mutations use deterministic idempotency keys.
 *
 * The ingress test requires MongoDB because the unique index is enforced by Mongo.
 */
test("FTR-WH-IDEM-001 WebhookEvent has a unique shop + webhookId index", () => {
  const indexes = WebhookEvent.schema.indexes();
  const unique = indexes.find(([keys, options]) =>
    keys.shop === 1 && keys.webhookId === 1 && options?.unique === true
  );
  assert.ok(unique, "WebhookEvent must enforce unique {shop, webhookId}");
});

test("FTR-WH-IDEM-002 duplicate Shopify webhook delivery is rejected by the database", async (t) => {
  const mongoose = (await import("mongoose")).default;
  const uri = process.env.MONGODB_URI;
  if (!uri) return t.skip("MONGODB_URI is required for database idempotency test");

  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || undefined });

  const shop = "ftr-idempotency-test.myshopify.com";
  const webhookId = `ftr-idem-${process.pid}-${Date.now()}`;
  try {
    await WebhookEvent.init();
    await WebhookEvent.create({
      shop, webhookId, topic: "orders/paid", payload: { id: "idem-order" },
      status: "PENDING", nextAttemptAt: new Date(),
      metadata: { idempotencyTest: webhookId },
    });

    await assert.rejects(
      WebhookEvent.create({
        shop, webhookId, topic: "orders/paid", payload: { id: "idem-order" },
        status: "PENDING", nextAttemptAt: new Date(),
        metadata: { idempotencyTest: webhookId },
      }),
      error => error?.code === 11000,
      "same Shopify webhook must not create a second queued event"
    );

    assert.equal(await WebhookEvent.countDocuments({ shop, webhookId }), 1);
  } finally {
    await WebhookEvent.deleteMany({ shop, webhookId });
    if (ownsConnection) await mongoose.disconnect();
  }
});

test("FTR-WH-IDEM-003 same webhookId may exist for a different shop", async (t) => {
  const mongoose = (await import("mongoose")).default;
  const uri = process.env.MONGODB_URI;
  if (!uri) return t.skip("MONGODB_URI is required for database idempotency test");

  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || undefined });

  const webhookId = `ftr-cross-shop-${process.pid}-${Date.now()}`;
  const shops = ["ftr-idem-a.myshopify.com", "ftr-idem-b.myshopify.com"];
  try {
    await WebhookEvent.init();
    await WebhookEvent.create(shops.map(shop => ({
      shop, webhookId, topic: "refunds/create", payload: { id: "idem-refund" },
      status: "PENDING", nextAttemptAt: new Date(),
      metadata: { idempotencyTest: webhookId },
    })));
    assert.equal(await WebhookEvent.countDocuments({ webhookId }), 2);
  } finally {
    await WebhookEvent.deleteMany({ webhookId });
    if (ownsConnection) await mongoose.disconnect();
  }
});
