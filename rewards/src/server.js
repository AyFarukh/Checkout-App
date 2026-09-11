import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { connectDatabase, databaseHealth } from "./config/db.js";
import { adminApi } from "./routes/adminApi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3100);

app.disable("x-powered-by");
app.use(cors({ origin: false }));
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.resolve(__dirname, "../public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "freetheroot-rewards-admin", database: databaseHealth() });
});

app.use("/api/admin", adminApi);

app.use((error, _req, res, _next) => {
  console.error("[Rewards Admin]", error);
  const status = error?.code === 11000 ? 409 : 500;
  res.status(status).json({ error: status === 409 ? "Duplicate transaction" : error.message || "Internal server error" });
});

async function start() {
  await connectDatabase();
  app.listen(port, () => {
    console.log(`[Rewards Admin] running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("[Rewards Admin] failed to start", error);
  process.exit(1);
});
