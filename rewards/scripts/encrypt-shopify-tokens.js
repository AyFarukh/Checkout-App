import "dotenv/config";
import mongoose from "mongoose";
import { ShopifyOfflineToken } from "../src/models/ShopifyOfflineToken.js";
import { migrateOfflineTokenRecord } from "../src/services/shopify-token.service.js";
import { encryptToken } from "../src/services/token-encryption.service.js";

// Validate configuration before opening a database connection. Never print keys,
// token values, records or connection strings, including on failure.
try {
  encryptToken("configuration-check", "migration", "access");
  if (!process.env.MONGODB_URI) throw Object.assign(new Error(), { code: "MONGODB_URI_REQUIRED" });
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || undefined });
  let scanned = 0;
  for await (const record of ShopifyOfflineToken.find().cursor()) {
    await migrateOfflineTokenRecord(record);
    scanned++;
  }
  console.log(`Shopify token encryption migration complete; ${scanned} records checked.`);
} catch (error) {
  console.error("Shopify token encryption migration failed", error.code || "MIGRATION_FAILED");
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
