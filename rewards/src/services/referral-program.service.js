export function defaultReferralProgram() {
  return {
    revision: 0, friendDiscountAmount: 10, referrerPoints: 200, minimumOrderAmount: 0, attributionDays: 30,
    milestones: [
      { id: "first-referral", threshold: 1, kind: "REFERRAL_POINTS", title: "200 referral points", points: 0 },
      { id: "shampoo-bar", threshold: 3, kind: "PRODUCT", title: "Free Shampoo Bar" },
      { id: "full-size-mist", threshold: 5, kind: "PRODUCT", title: "Free Full-Size Mist" },
      { id: "four-mist-bundle", threshold: 10, kind: "PRODUCT", title: "Free Four Mist Bundle" },
    ],
  };
}
function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400, code: "REFERRAL_CONFIGURATION_INVALID" }); }
function integer(value, min, max, field) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${field} must be an integer from ${min} to ${max}.`);
  return value;
}
function amount(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) invalid(`${field} must be a valid amount with at most two decimal places.`);
  return value;
}
export function normalizeReferralProgram(input) {
  if (!input || typeof input !== "object") invalid("Referral configuration is required.");
  const referrerPoints = integer(input.referrerPoints, 1, 100000, "Referral points");
  const friendDiscountAmount = amount(input.friendDiscountAmount, "Friend discount");
  if (friendDiscountAmount === 0) invalid("Friend discount must be greater than zero.");
  if (!Array.isArray(input.milestones) || input.milestones.length > 50) invalid("Provide up to 50 milestones.");
  const ids = new Set(), thresholds = new Set();
  const milestones = input.milestones.map(m => {
    if (!m || typeof m !== "object") invalid("Invalid milestone.");
    const id = String(m.id || "");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) invalid("Milestone IDs must be unique.");
    ids.add(id);
    const threshold = integer(m.threshold, 1, 100000, "Referral threshold");
    if (thresholds.has(threshold)) invalid("Each referral threshold may have only one milestone.");
    thresholds.add(threshold);
    const title = String(m.title || "").trim();
    if (!title || title.length > 100) invalid("Milestone title must contain 1–100 characters.");
    if (!["REFERRAL_POINTS", "POINTS", "PRODUCT"].includes(m.kind)) invalid("Unsupported milestone type.");
    if (m.kind === "REFERRAL_POINTS" && threshold !== 1) invalid("The base referral points row belongs at the first referral.");
    if (threshold === 1 && m.kind !== "REFERRAL_POINTS") invalid("The first referral already earns the base points; add bonus milestones after it.");
    const productId = m.kind === "PRODUCT" && m.productId ? String(m.productId) : null;
    const variantId = m.kind === "PRODUCT" && m.variantId ? String(m.variantId) : null;
    if (Boolean(productId) !== Boolean(variantId) || (productId && !/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) || (variantId && !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId))) invalid("Choose a Shopify product and one of its variants, or leave both empty for a draft.");
    return { id, threshold, kind: m.kind, title: m.kind === "REFERRAL_POINTS" ? `${referrerPoints} referral points` : title,
      points: m.kind === "POINTS" ? integer(m.points, 1, 100000, "Bonus points") : 0,
      quantity: m.kind === "PRODUCT" ? integer(m.quantity ?? 1, 1, 10, "Gift quantity") : 1,
      productId, variantId, productTitle: "", variantTitle: "" };
  }).sort((a, b) => a.threshold - b.threshold);
  if (!milestones.some(m => m.kind === "REFERRAL_POINTS")) invalid("Keep the first-referral points row to describe the base award.");
  return { friendDiscountAmount, referrerPoints, minimumOrderAmount: amount(input.minimumOrderAmount ?? 0, "Minimum order amount"),
    attributionDays: integer(input.attributionDays ?? 30, 1, 365, "Attribution days"), milestones };
}
