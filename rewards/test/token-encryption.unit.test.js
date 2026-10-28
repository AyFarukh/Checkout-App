import test from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "../src/services/token-encryption.service.js";

function key(t) {
  const previous = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  t.after(() => previous === undefined ? delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY : process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = previous);
}
test("tokens round trip with randomized authenticated ciphertext", t => {
  key(t);
  const first = encryptToken("private-access", "a.myshopify.com", "access");
  assert.notEqual(first, encryptToken("private-access", "a.myshopify.com", "access"));
  assert.ok(!first.includes("private-access"));
  assert.equal(decryptToken(first, "a.myshopify.com", "access"), "private-access");
});
test("ciphertext cannot move between shops or token fields", t => {
  key(t);
  const encrypted = encryptToken("private-access", "a.myshopify.com", "access");
  for (const [shop, purpose] of [["b.myshopify.com", "access"], ["a.myshopify.com", "refresh"]]) {
    assert.throws(() => decryptToken(encrypted, shop, purpose), { code: "SHOPIFY_TOKEN_DECRYPT_FAILED" });
  }
});
test("tampered ciphertext and wrong encryption keys fail without revealing data", t => {
  key(t);
  const encrypted = encryptToken("private-access", "a.myshopify.com", "access");
  const pieces = encrypted.split(":");
  const bytes = Buffer.from(pieces[4], "base64"); bytes[0] ^= 1; pieces[4] = bytes.toString("base64");
  assert.throws(() => decryptToken(pieces.join(":"), "a.myshopify.com", "access"), { code: "SHOPIFY_TOKEN_DECRYPT_FAILED" });
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  assert.throws(() => decryptToken(encrypted, "a.myshopify.com", "access"), { code: "SHOPIFY_TOKEN_DECRYPT_FAILED" });
});
test("missing or invalid encryption key refuses writes", t => {
  key(t);
  for (const value of ["", "short", Buffer.alloc(16).toString("base64")]) {
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = value;
    assert.throws(() => encryptToken("private-access", "a.myshopify.com", "access"), { code: "SHOPIFY_TOKEN_KEY_INVALID" });
  }
});
