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
var MAX_PICKS = 50;
var SET_ID = /^set-[A-Za-z0-9-]{8,100}$/;
var PRODUCT_ID = /^gid:\/\/shopify\/Product\/\d+$/;
function blockProducts(field) {
  if (field?.type !== "list.product_reference" || !Array.isArray(field.jsonValue) || field.jsonValue.length === 0 || field.jsonValue.length > MAX_PRODUCTS_PER_BLOCK || field.jsonValue.some((id) => typeof id !== "string" || !PRODUCT_ID.test(id))) return null;
  return new Set(field.jsonValue);
}
function validVariant(line) {
  return typeof line.id === "string" && line.id.length > 0 && line.merchandise?.__typename === "ProductVariant" && typeof line.merchandise.product?.id === "string" && PRODUCT_ID.test(line.merchandise.product.id) && Number.isSafeInteger(line.quantity) && line.quantity > 0 && !line.sellingPlanAllocation;
}
function requiredCount(field) {
  if (field == null) return 0;
  if (field.type !== "number_integer" || !Number.isSafeInteger(field.jsonValue) || field.jsonValue < 0 || field.jsonValue > MAX_PICKS) return null;
  return field.jsonValue;
}
function fillsBlocks(picks, blocks) {
  const quantities = /* @__PURE__ */ new Map();
  for (const pick of picks) quantities.set(pick, (quantities.get(pick) || 0) + 1);
  const products = [...quantities.keys()];
  const sink = 1 + products.length + blocks.length;
  const capacity = Array.from({ length: sink + 1 }, () => Array(sink + 1).fill(0));
  const adjacent = Array.from({ length: sink + 1 }, () => []);
  const edge = (from, to, units) => {
    adjacent[from].push(to);
    adjacent[to].push(from);
    capacity[from][to] = units;
  };
  products.forEach((product, index) => {
    edge(0, index + 1, quantities.get(product));
    blocks.forEach((block, blockIndex) => {
      if (block.products.has(product)) edge(index + 1, 1 + products.length + blockIndex, MAX_PICKS);
    });
  });
  blocks.forEach((block, index) => edge(1 + products.length + index, sink, block.quantity));
  let flow = 0;
  while (flow < picks.length) {
    const previous = Array(sink + 1).fill(-1);
    previous[0] = 0;
    const queue = [0];
    for (let head = 0; head < queue.length && previous[sink] === -1; head++) {
      const from = queue[head];
      for (const to of adjacent[from]) {
        if (previous[to] === -1 && capacity[from][to] > 0) {
          previous[to] = from;
          queue.push(to);
        }
      }
    }
    if (previous[sink] === -1) return false;
    let units = MAX_PICKS;
    for (let to = sink; to !== 0; to = previous[to]) units = Math.min(units, capacity[previous[to]][to]);
    for (let to = sink; to !== 0; to = previous[to]) {
      capacity[previous[to]][to] -= units;
      capacity[to][previous[to]] += units;
    }
    flow += units;
  }
  return true;
}
function priceSet(lines) {
  if (new Set(lines.map((line) => line.id)).size !== lines.length) return [];
  const parents = lines.filter((line) => line.parentMarker?.value === "true");
  if (parents.length !== 1) return [];
  const parent = parents[0];
  if (!validVariant(parent)) return [];
  const paidAmount = Number(parent.cost?.amountPerQuantity?.amount);
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return [];
  const parentProduct = parent.merchandise.product;
  const blocks = [];
  const productLists = [parentProduct.block1, parentProduct.block2, parentProduct.block3, parentProduct.block4];
  const countFields = [parentProduct.block1Count, parentProduct.block2Count, parentProduct.block3Count, parentProduct.block4Count];
  let expectedPicks = 0;
  for (let index = 0; index < productLists.length; index++) {
    const quantity = requiredCount(countFields[index]);
    if (quantity === null) return [];
    if (quantity === 0) continue;
    const products = blockProducts(productLists[index]);
    if (!products || expectedPicks + quantity > MAX_PICKS) return [];
    blocks.push({ products, quantity });
    expectedPicks += quantity;
  }
  if (expectedPicks === 0) return [];
  const children = lines.filter((line) => line !== parent);
  const picks = [];
  for (const child of children) {
    if (!validVariant(child) || child.parentMarker?.value || child.merchandise.product.id === parentProduct.id || child.quantity % parent.quantity !== 0) return [];
    const units = child.quantity / parent.quantity;
    if (units < 1 || picks.length + units > expectedPicks) return [];
    for (let unit = 0; unit < units; unit++) picks.push(child.merchandise.product.id);
  }
  if (picks.length !== expectedPicks || !fillsBlocks(picks, blocks)) return [];
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
  for (const members of sets.values()) operations.push(...priceSet(members));
  return { operations };
}

// <stdin>
function cartTransformRun() {
  return run_default(run);
}
export {
  cartTransformRun
};
