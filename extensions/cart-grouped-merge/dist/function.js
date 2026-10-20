// extensions/cart-grouped-merge/node_modules/@shopify/shopify_function/run.ts
function run_default(userfunction) {
  try {
    ShopifyFunction;
  } catch (e) {
    throw new Error(
      "ShopifyFunction is not defined. Please rebuild your function using the latest version of Shopify CLI."
    );
  }
  const input_obj = ShopifyFunction.readInput();
  const output_obj = userfunction(input_obj);
  ShopifyFunction.writeOutput(output_obj);
}

// extensions/cart-grouped-merge/src/run.ts
var MAX_BUNDLE_LINES = 50;
var SET_ID = /^set-[A-Za-z0-9-]{8,100}$/;
function variantNumber(gid) {
  return typeof gid === "string" && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(gid) ? gid.split("/").pop() : null;
}
function validSet(line) {
  const setId = line.setId?.value;
  return typeof setId === "string" && SET_ID.test(setId) && line.bundleId?.value === setId;
}
function run(input) {
  const lines = input?.cart?.lines || [];
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_BUNDLE_LINES) {
    return { operations: [] };
  }
  const parents = /* @__PURE__ */ new Map();
  const childCounts = /* @__PURE__ */ new Map();
  for (const line of lines) {
    if (line.parentMarker?.value !== "true" || !validSet(line) || line.parentVariantId?.value || line.merchandise?.__typename !== "ProductVariant" || !Number.isInteger(line.quantity) || line.quantity < 1) continue;
    const parentId = variantNumber(line.merchandise.id);
    if (!parentId) continue;
    const setId = line.setId.value;
    if (parents.has(setId)) {
      parents.set(setId, null);
    } else {
      parents.set(setId, { id: parentId, quantity: line.quantity });
    }
  }
  const candidates = [];
  for (const line of lines) {
    if (line.parentMarker?.value || !line.parentVariantId?.value || !validSet(line) || line.merchandise?.__typename !== "ProductVariant" || !Number.isInteger(line.quantity) || line.quantity < 1) continue;
    const setId = line.setId.value;
    const parent = parents.get(setId);
    const childId = variantNumber(line.merchandise.id);
    if (!parent || !childId || childId === parent.id || parent.id !== line.parentVariantId.value || line.quantity !== parent.quantity) continue;
    childCounts.set(setId, (childCounts.get(setId) || 0) + 1);
    candidates.push({ line, setId });
  }
  const operations = [];
  for (const { line, setId } of candidates) {
    const count = childCounts.get(setId) || 0;
    if (count < 1 || count > 20) continue;
    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        price: {
          adjustment: {
            fixedPricePerUnit: { amount: "0.00" }
          }
        }
      }
    });
  }
  return { operations };
}

// <stdin>
function cartTransformRun() {
  return run_default(run);
}
export {
  cartTransformRun
};
