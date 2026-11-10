/**
 * FTR bundle pricing. Line properties identify a selection; Shopify product
 * metafields authorize it. Product lists are live; the app-owned quantity
 * snapshot supplies the required counts without exceeding input query cost.
 * Invalid/incomplete sets emit no operations. Parent pricing is never changed.
 */
const MAX_CART_LINES = 50;
const MAX_PRODUCTS_PER_BLOCK = 256;
const MAX_PICKS = 50;
const SET_ID = /^set-[A-Za-z0-9-]{8,100}$/;
const PRODUCT_ID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

type Metafield = {type?: string; jsonValue?: unknown};
type Line = {
  id?: string;
  quantity?: number;
  parentMarker?: {value?: string} | null;
  setId?: {value?: string} | null;
  bundleId?: {value?: string} | null;
  parentVariantId?: {value?: string} | null;
  legacyParent?: {value?: string} | null;
  legacySet?: {value?: string} | null;
  legacyParentVariant?: {value?: string} | null;
  legacyBundle?: {value?: string} | null;
  cost?: {amountPerQuantity?: {amount?: string}};
  sellingPlanAllocation?: unknown;
  merchandise?: {
    __typename?: string;
    id?: string;
    product?: {id?: string; block1?: Metafield | null; block2?: Metafield | null; block3?: Metafield | null; block4?: Metafield | null};
  };
};

type PriceOperation = {lineUpdate: {cartLineId: string; price: {adjustment: {fixedPricePerUnit: {amount: string}}}}};

function blockProducts(field: Metafield | null | undefined): Set<string> | null {
  if (field?.type !== 'list.product_reference' || !Array.isArray(field.jsonValue) ||
      field.jsonValue.length === 0 || field.jsonValue.length > MAX_PRODUCTS_PER_BLOCK ||
      field.jsonValue.some(id => typeof id !== 'string' || !PRODUCT_ID.test(id))) return null;
  return new Set(field.jsonValue as string[]);
}

function validVariant(line: Line): boolean {
  return typeof line.id === 'string' && line.id.length > 0 &&
    line.merchandise?.__typename === 'ProductVariant' &&
    typeof line.merchandise.id === 'string' && VARIANT_ID.test(line.merchandise.id) &&
    typeof line.merchandise.product?.id === 'string' && PRODUCT_ID.test(line.merchandise.product.id) &&
    Number.isSafeInteger(line.quantity) && line.quantity! > 0 && !line.sellingPlanAllocation;
}

type Block = {products: Set<string>; quantity: number};

function requiredCount(value: unknown): number | null {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_PICKS) return null;
  return value as number;
}

// Bounded flow assigns product quantities to block capacities. Reverse edges
// resolve overlapping lists without exponential search or greedy allocation.
function fillsBlocks(picks: string[], blocks: Block[]): boolean {
  const quantities = new Map<string, number>();
  for (const pick of picks) quantities.set(pick, (quantities.get(pick) || 0) + 1);
  const products = [...quantities.keys()];
  const sink = 1 + products.length + blocks.length;
  const capacity = Array.from({length: sink + 1}, () => Array(sink + 1).fill(0) as number[]);
  const adjacent = Array.from({length: sink + 1}, () => [] as number[]);
  const edge = (from: number, to: number, units: number) => {
    adjacent[from].push(to); adjacent[to].push(from); capacity[from][to] = units;
  };
  products.forEach((product, index) => {
    edge(0, index + 1, quantities.get(product)!);
    blocks.forEach((block, blockIndex) => {
      if (block.products.has(product)) edge(index + 1, 1 + products.length + blockIndex, MAX_PICKS);
    });
  });
  blocks.forEach((block, index) => edge(1 + products.length + index, sink, block.quantity));
  let flow = 0;
  while (flow < picks.length) {
    const previous: number[] = Array(sink + 1).fill(-1);
    previous[0] = 0;
    const queue = [0];
    for (let head = 0; head < queue.length && previous[sink] === -1; head++) {
      const from = queue[head];
      for (const to of adjacent[from]) {
        if (previous[to] === -1 && capacity[from][to] > 0) {
          previous[to] = from; queue.push(to);
        }
      }
    }
    if (previous[sink] === -1) return false;
    let units = MAX_PICKS;
    for (let to = sink; to !== 0; to = previous[to]) units = Math.min(units, capacity[previous[to]][to]);
    for (let to = sink; to !== 0; to = previous[to]) {
      capacity[previous[to]][to] -= units; capacity[to][previous[to]] += units;
    }
    flow += units;
  }
  return true;
}

function priceSet(lines: Line[], setId: string, blockCounts: Record<string, unknown>): PriceOperation[] {
  // Test sets must not carry the legacy properties consumed by the old app.
  // An optional test bundle ID may duplicate the set ID but never contradict it.
  if (lines.some(line => (line.bundleId != null && line.bundleId.value !== setId) ||
      [line.legacyParent, line.legacySet, line.legacyParentVariant, line.legacyBundle]
        .some(attribute => attribute != null)) ||
      new Set(lines.map(line => line.id)).size !== lines.length) return [];
  const parents = lines.filter(line => line.parentMarker?.value === 'true');
  if (parents.length !== 1) return [];
  const parent = parents[0];
  if (!validVariant(parent) || parent.parentVariantId?.value) return [];
  const paidAmount = Number(parent.cost?.amountPerQuantity?.amount);
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return [];
  const parentProduct = parent.merchandise!.product!;
  const blocks: Block[] = [];
  const productLists = [parentProduct.block1, parentProduct.block2, parentProduct.block3, parentProduct.block4];
  const productNumber = parentProduct.id!.split('/').pop()!;
  if (!Object.prototype.hasOwnProperty.call(blockCounts, productNumber)) return [];
  const countFields = blockCounts[productNumber];
  if (!Array.isArray(countFields) || countFields.length !== 4) return [];
  let expectedPicks = 0;
  for (let index = 0; index < productLists.length; index++) {
    const quantity = requiredCount(countFields[index]);
    if (quantity === null) return [];
    if (quantity === 0) continue;
    const products = blockProducts(productLists[index]);
    if (!products || expectedPicks + quantity > MAX_PICKS) return [];
    blocks.push({products, quantity}); expectedPicks += quantity;
  }
  if (expectedPicks === 0) return [];
  const parentVariantNumber = parent.merchandise!.id!.split('/').pop();
  const children = lines.filter(line => line !== parent);
  const picks: string[] = [];
  for (const child of children) {
    if (!validVariant(child) || child.parentMarker?.value ||
        child.parentVariantId?.value !== parentVariantNumber ||
        child.merchandise!.product!.id === parentProduct.id ||
        child.quantity! % parent.quantity! !== 0) return [];
    // Shopify can merge an identical variant selected in multiple blocks. The
    // number of included picks is its quantity divided by parent quantity.
    const units = child.quantity! / parent.quantity!;
    if (units < 1 || picks.length + units > expectedPicks) return [];
    for (let unit = 0; unit < units; unit++) picks.push(child.merchandise!.product!.id!);
  }
  if (picks.length !== expectedPicks || !fillsBlocks(picks, blocks)) return [];
  return children.map(child => ({lineUpdate: {
    cartLineId: child.id!,
    price: {adjustment: {fixedPricePerUnit: {amount: '0.00'}}},
  }}));
}

type RunInput = {
  cartTransform?: {testConfiguration?: {jsonValue?: unknown} | null} | null;
  cart?: {testFlag?: {value?: string} | null; lines?: Line[]};
};

export function run(input: RunInput): {operations: PriceOperation[]} {
  // Both the app-owned switch and this individual cart must opt into testing.
  // A storefront attribute is a selector, never authorization to price products.
  const config = input?.cartTransform?.testConfiguration?.jsonValue;
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config as {testEnabled?: unknown}).testEnabled !== true ||
      (config as {countsVersion?: unknown}).countsVersion !== 1 ||
      input?.cart?.testFlag?.value !== 'true') return {operations: []};
  const blockCounts = (config as {blockCounts?: unknown}).blockCounts;
  if (!blockCounts || typeof blockCounts !== 'object' || Array.isArray(blockCounts)) return {operations: []};
  const lines = input?.cart?.lines || [];
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_CART_LINES) return {operations: []};
  const sets = new Map<string, Line[]>();
  for (const line of lines) {
    const setId = line?.setId?.value;
    if (typeof setId !== 'string' || !SET_ID.test(setId)) continue;
    const members = sets.get(setId) || [];
    members.push(line);sets.set(setId, members);
  }
  const operations: PriceOperation[] = [];
  for (const [setId, members] of sets) operations.push(...priceSet(members, setId, blockCounts as Record<string, unknown>));
  return {operations};
}
