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
var MAX_CART_LINES = 50;
var MAX_PRODUCTS_PER_BLOCK = 256;
var SET_ID = /^set-[A-Za-z0-9-]{8,100}$/;
var PRODUCT_ID = /^gid:\/\/shopify\/Product\/\d+$/;
var VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
function blockProducts(field) {
  if (field?.type !== "list.product_reference" || !Array.isArray(field.jsonValue) || field.jsonValue.length === 0 || field.jsonValue.length > MAX_PRODUCTS_PER_BLOCK || field.jsonValue.some((id) => typeof id !== "string" || !PRODUCT_ID.test(id))) return null;
  return new Set(field.jsonValue);
}
function validVariant(line) {
  return typeof line.id === "string" && line.id.length > 0 && line.merchandise?.__typename === "ProductVariant" && typeof line.merchandise.id === "string" && VARIANT_ID.test(line.merchandise.id) && typeof line.merchandise.product?.id === "string" && PRODUCT_ID.test(line.merchandise.product.id) && Number.isSafeInteger(line.quantity) && line.quantity > 0 && !line.sellingPlanAllocation;
}
function fillsEveryBlock(picks, blocks, index = 0, used = 0) {
  if (index === picks.length) return used === (1 << blocks.length) - 1;
  for (let block = 0; block < blocks.length; block++) {
    if (!(used & 1 << block) && blocks[block].has(picks[index]) && fillsEveryBlock(picks, blocks, index + 1, used | 1 << block)) return true;
  }
  return false;
}
function priceSet(lines, setId) {
  if (lines.some((line) => line.bundleId?.value !== setId) || new Set(lines.map((line) => line.id)).size !== lines.length) return [];
  const parents = lines.filter((line) => line.parentMarker?.value === "true");
  if (parents.length !== 1) return [];
  const parent = parents[0];
  if (!validVariant(parent) || parent.parentVariantId?.value) return [];
  const paidAmount = Number(parent.cost?.amountPerQuantity?.amount);
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return [];
  const parentProduct = parent.merchandise.product;
  const parsed = [parentProduct.block1, parentProduct.block2, parentProduct.block3].map(blockProducts);
  if (parsed.some((block) => !block)) return [];
  const blocks = parsed;
  const parentVariantNumber = parent.merchandise.id.split("/").pop();
  const children = lines.filter((line) => line !== parent);
  const picks = [];
  for (const child of children) {
    if (!validVariant(child) || child.parentMarker?.value || child.parentVariantId?.value !== parentVariantNumber || child.merchandise.product.id === parentProduct.id || child.quantity % parent.quantity !== 0) return [];
    const units = child.quantity / parent.quantity;
    if (units < 1 || picks.length + units > blocks.length) return [];
    for (let unit = 0; unit < units; unit++) picks.push(child.merchandise.product.id);
  }
  if (picks.length !== blocks.length || !fillsEveryBlock(picks, blocks)) return [];
  return children.map((child) => ({ lineUpdate: {
    cartLineId: child.id,
    price: { adjustment: { fixedPricePerUnit: { amount: "0.00" } } }
  } }));
}
function run(input) {
  const lines = input?.cart?.lines || [];
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_CART_LINES) return { operations: [] };
  const sets = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const setId = line?.setId?.value;
    if (typeof setId !== "string" || !SET_ID.test(setId)) continue;
    const members = sets.get(setId) || [];
    members.push(line);
    sets.set(setId, members);
  }
  const operations = [];
  for (const [setId, members] of sets) operations.push(...priceSet(members, setId));
  return { operations };
}

// <stdin>
function cartTransformRun() {
  return run_default(run);
}
export {
  cartTransformRun
};
