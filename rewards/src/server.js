import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { connectDatabaseWithRetry, databaseHealth, requireDatabase } from "./config/db.js";
import { adminApi } from "./routes/adminApi.js";
import { customerApi } from "./routes/customerApi.js";
import { webhookRouter } from "./routes/webhooks.js";
import { processRewardSyncJobs } from "./services/shopify-sync.service.js";
import { releaseExpiredRedemptions } from "./services/redemption.service.js";
import { processWebhookJobs } from "./services/webhook-worker.service.js";
import { errorHandler, requestId } from "./middleware/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const app = express();
const port = Number(process.env.PORT || process.env.FRONTEND_PORT || 3100);
let workersRunning = false;

app.disable("x-powered-by");
app.use(requestId);
app.use("/webhooks", express.raw({ type: "application/json", limit: "1mb" }), requireDatabase, webhookRouter);
app.use(express.json({ limit: "256kb" }));
app.use(express.static(publicDir, { index: false }));

app.get("/health", (_req, res) => {
  const database = databaseHealth();
  res.status(database.status === "connected" ? 200 : 503).json({ ok: database.status === "connected", service: "freetheroot-rewards-admin", database });
});

app.use("/api/admin", requireDatabase, adminApi);
// Shopify Customer Account UI extensions execute in a sandboxed worker with a null origin.
// Authentication is provided by the verified Shopify session token, not by CORS.
app.use("/api/customer", cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"] }), requireDatabase, customerApi);
app.get(/^(?!\/api\/|\/health$|\/webhooks\/).*/, async (_req, res, next) => {
  try {
    const template = await fs.readFile(path.join(publicDir, "index.html"), "utf8");
    res.type("html").send(template.replaceAll("%SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || ""));
  } catch (error) { next(error); }
});
app.use(errorHandler);

app.listen(port, "0.0.0.0", () => {
  console.log(`[Rewards Admin] embedded app home running on port ${port}`);
  connectDatabaseWithRetry();
});

setInterval(async () => {
  if (databaseHealth().status !== "connected" || workersRunning) return;
  workersRunning = true;
  try {
    await processWebhookJobs();
    await processRewardSyncJobs();
    await releaseExpiredRedemptions();
  } catch (error) {
    console.error("[Rewards Worker]", error);
  } finally {
    workersRunning = false;
  }
}, 5000).unref();
