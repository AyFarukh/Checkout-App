/**
 * FTR bundle child pricing.
 * Merchant-controlled parent product metafield:
 * custom.ftr_bundle_children (type: json)
 * Example: ["48839676526883","48839675937059","48839676592419"]
 *
 * Cart attributes are used only for grouping, never for authorization.
 * The metafield must explicitly list every eligible child variant.
 */
function variantNumber(gid) {
  return typeof gid === 'string' && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(gid)
    ? gid.split('/').pop() : null;
}
function allowedVariants(parent) {
  const raw = parent.merchandise?.product?.bundleChildren?.jsonValue;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null;
  const variants = new Set();
  for (const item of raw) {
    const id = String(item);
    const number = /^\d+$/.test(id) ? id : variantNumber(id);
    if (!number) return null;
    variants.add(number);
  }
  return variants;
}
export function run(input) {
  const lines = input?.cart?.lines || [];
  const parents = new Map();
  for (const line of lines) {
    if (line.parentMarker?.value !== 'true' || !line.setId?.value ||
        line.bundleId?.value !== line.setId.value ||
        line.merchandise?.__typename !== 'ProductVariant' ||
        !Number.isInteger(line.quantity) || line.quantity < 1) continue;
    const id = variantNumber(line.merchandise.id);
    const allowed = allowedVariants(line);
    if (!id || !allowed || allowed.has(id)) continue;
    const key = line.setId.value;
    if (parents.has(key)) {
      parents.set(key, null); // Duplicate parents invalidate the whole set.
    } else {
      parents.set(key, {id, allowed, quantity: line.quantity});
    }
  }
  const operations = [];
  for (const line of lines) {
    if (!line.parentVariantId?.value || !line.setId?.value ||
        line.bundleId?.value !== line.setId.value ||
        line.merchandise?.__typename !== 'ProductVariant') continue;
    const parent = parents.get(line.setId.value);
    if (!parent || parent.id !== line.parentVariantId.value ||
        line.quantity !== parent.quantity) continue;
    const childId = variantNumber(line.merchandise.id);
    if (!childId || !parent.allowed.has(childId)) continue;
    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        price: {adjustment: {fixedPricePerUnit: {amount: '0.00'}}},
      },
    });
  }
  return {operations};
}
