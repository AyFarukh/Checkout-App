import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
function key() {
  const value = String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || "");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw Object.assign(new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key"), { code: "SHOPIFY_TOKEN_KEY_INVALID", permanent: true });
  }
  return decoded;
}
export function isEncryptedToken(value) { return typeof value === "string" && value.startsWith(PREFIX); }
export function assertTokenEncryptionConfigured() { key(); }
export function encryptToken(value, shop, purpose) {
  if (value == null) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`v1:${shop}:${purpose}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}
export function decryptToken(value, shop, purpose) {
  if (value == null) return null;
  // Legacy values remain readable only so the service can migrate them on use.
  if (!isEncryptedToken(value)) return value;
  const encryptionKey = key();
  try {
    const parts = value.split(":");
    if (parts.length !== 5) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(parts[2], "base64"));
    decipher.setAAD(Buffer.from(`v1:${shop}:${purpose}`));
    decipher.setAuthTag(Buffer.from(parts[3], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw Object.assign(new Error("Stored Shopify credentials could not be decrypted"), { code: "SHOPIFY_TOKEN_DECRYPT_FAILED", permanent: true });
  }
}
