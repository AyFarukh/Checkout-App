import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { connectDatabase, databaseHealth } from "./config/db.js";
import { adminApi } from "./routes/adminApi.js";
import { webhookRouter } from "./routes/webhooks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const app = express();
const port = Number(process.env.PORT || process.env.FRONTEND_PORT || 3100);

app.disable("x-powered-by");
app.use(cors({ origin: false }));

// Shopify webhook HMAC must be verified against the exact raw request bytes.
app.use("/webhooks", express.raw({ type: "application/json", limit: "1mb" }), webhookRouter);

app.use(express.json({ limit: "256kb" }));
app.use(express.static(publicDir, { index: false }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "freetheroot-rewards-admin", database: databaseHealth() });
});

app.use("/api/admin", adminApi);

app.get(/^(?!\/api\/|\/health$|\/webhooks\/).*/, async (_req, res, next) => {
  try {
    const template = await fs.readFile(path.join(publicDir, "index.html"), "utf8");
    const apiKey = process.env.SHOPIFY_API_KEY || "";
    res.type("html").send(template.replaceAll("%SHOPIFY_API_KEY%", apiKey));
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error("[Rewards Admin]", error);
  const status = error?.statusCode || (error?.code === 11000 ? 409 : 500);
  res.status(status).json({ error: status === 409 ? "Duplicate transaction" : error.message || "Internal server error" });
});

async function start() {
  await connectDatabase();
  app.listen(port, "0.0.0.0", () => console.log(`[Rewards Admin] embedded app home running on port ${port}`));
}

start().catch((error) => {
  console.error("[Rewards Admin] failed to start", error);
  process.exit(1);
});
