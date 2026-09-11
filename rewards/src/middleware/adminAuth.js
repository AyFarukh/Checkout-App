export function adminAuth(req, res, next) {
  const configuredKey = process.env.REWARDS_ADMIN_KEY;

  if (!configuredKey) {
    return res.status(503).json({ error: "REWARDS_ADMIN_KEY is not configured" });
  }

  const suppliedKey = req.get("x-rewards-admin-key");
  if (suppliedKey !== configuredKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
