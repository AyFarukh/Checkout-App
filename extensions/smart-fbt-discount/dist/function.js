// extensions/smart-fbt-discount/node_modules/@shopify/shopify_function/run.ts
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

// extensions/smart-fbt-discount/src/cart_lines_discounts_generate_run.js
var EMPTY_RESULT = { operations: [] };
var REQUIRED_BUNDLE_LINES = 3;
var PRODUCT_DISCOUNT_CLASS = "PRODUCT";
var ALL_SELECTION_STRATEGY = "ALL";
function clean(value) {
  return value == null ? "" : String(value).trim();
}
function parsePercentage(value) {
  const number = Number(clean(value));
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : null;
}
function isBundleLine(line) {
  return clean(line?.fbtBundle?.value).toLowerCase() === "true" && Boolean(clean(line?.fbtBundleId?.value)) && Number(line?.quantity || 0) > 0;
}
function merchandiseId(line) {
  return clean(line?.merchandise?.id);
}
function cartLinesDiscountsGenerateRun(input) {
  const discountClasses = input?.discount?.discountClasses || [];
  if (!discountClasses.includes(PRODUCT_DISCOUNT_CLASS)) return EMPTY_RESULT;
  const groups = /* @__PURE__ */ new Map();
  for (const line of input?.cart?.lines || []) {
    if (!isBundleLine(line)) continue;
    const bundleId = clean(line.fbtBundleId.value);
    const percentage = parsePercentage(line?.fbtDiscountPercentage?.value);
    if (percentage == null) continue;
    if (!groups.has(bundleId)) groups.set(bundleId, []);
    groups.get(bundleId).push({ line, percentage });
  }
  const candidates = [];
  for (const entries of groups.values()) {
    if (entries.length < REQUIRED_BUNDLE_LINES) continue;
    const percentages = new Set(entries.map((entry) => entry.percentage));
    if (percentages.size !== 1) continue;
    const distinctVariantIds = new Set(
      entries.map((entry) => merchandiseId(entry.line)).filter(Boolean)
    );
    if (distinctVariantIds.size < REQUIRED_BUNDLE_LINES) continue;
    const percentage = entries[0].percentage;
    const targets = entries.map((entry) => ({
      cartLine: {
        id: entry.line.id,
        quantity: 1
      }
    }));
    candidates.push({
      message: `Bundle ${percentage}% off`,
      targets,
      value: {
        percentage: {
          value: percentage
        }
      }
    });
  }
  if (!candidates.length) return EMPTY_RESULT;
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ALL_SELECTION_STRATEGY
        }
      }
    ]
  };
}

// <stdin>
function cartLinesDiscountsGenerateRun2() {
  return run_default(cartLinesDiscountsGenerateRun);
}
export {
  cartLinesDiscountsGenerateRun2 as cartLinesDiscountsGenerateRun
};
