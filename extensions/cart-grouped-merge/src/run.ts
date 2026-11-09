/**
 * FTR bundle pricing. Line properties identify a selection; Shopify product
 * metafields authorize it. Each paid parent requires one choice from each of
 * custom.block_1_products, custom.block_2_products and custom.block_3_products.
 * Invalid/incomplete sets emit no operations. Parent pricing is never changed.
 */
const MAX_CART_LINES = 50;
const MAX_PRODUCTS_PER_BLOCK = 256;
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
    product?: {id?: string; block1?: Metafield | null; block2?: Metafield | null; block3?: Metafield | null};
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

// A product may be offered in multiple blocks. Find a one-to-one assignment,
// rather than allowing three items that merely belong to the combined lists.
function fillsEveryBlock(picks: string[], blocks: Set<string>[], index = 0, used = 0): boolean {
  if (index === picks.length) return used === (1 << blocks.length) - 1;
  for (let block = 0; block < blocks.length; block++) {
    if (!(used & (1 << block)) && blocks[block].has(picks[index]) &&
        fillsEveryBlock(picks, blocks, index + 1, used | (1 << block))) return true;
  }
  return false;
}

function priceSet(lines: Line[], setId: string): PriceOperation[] {
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
  const parsed = [parentProduct.block1, parentProduct.block2, parentProduct.block3].map(blockProducts);
  if (parsed.some(block => !block)) return [];
  const blocks = parsed as Set<string>[];
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
    if (units < 1 || picks.length + units > blocks.length) return [];
    for (let unit = 0; unit < units; unit++) picks.push(child.merchandise!.product!.id!);
  }
  if (picks.length !== blocks.length || !fillsEveryBlock(picks, blocks)) return [];
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
      input?.cart?.testFlag?.value !== 'true') return {operations: []};
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
  for (const [setId, members] of sets) operations.push(...priceSet(members, setId));
  return {operations};
}
