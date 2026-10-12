/**
 * FTR dynamic bundle pricing (2026-07).
 *
 * Parent:
 *   _parent=true
 *   _set=<unique set id>
 *   _bundleId=<same unique set id>
 *
 * Children:
 *   _parent_product_id=<parent variant numeric id>
 *   _set=<same unique set id>
 *   _bundleId=<same unique set id>
 *
 * Children are dynamic by design. Matching child lines receive a fixed
 * per-unit price of 0.00 while the parent keeps its merchandise price.
 */
const MAX_BUNDLE_LINES = 50;
const SET_ID = /^set-[A-Za-z0-9-]{8,100}$/;

function variantNumber(gid) {
  return typeof gid === 'string' && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(gid)
    ? gid.split('/').pop()
    : null;
}

function validSet(line) {
  const setId = line.setId?.value;
  return typeof setId === 'string' &&
    SET_ID.test(setId) &&
    line.bundleId?.value === setId;
}

export function run(input) {
  const lines = input?.cart?.lines || [];
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_BUNDLE_LINES) {
    return {operations: []};
  }

  const parents = new Map();
  const childCounts = new Map();

  // Pass 1: establish exactly one valid parent per set.
  for (const line of lines) {
    if (
      line.parentMarker?.value !== 'true' ||
      !validSet(line) ||
      line.parentVariantId?.value ||
      line.merchandise?.__typename !== 'ProductVariant' ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) continue;

    const parentId = variantNumber(line.merchandise.id);
    if (!parentId) continue;

    const setId = line.setId.value;
    if (parents.has(setId)) {
      parents.set(setId, null);
    } else {
      parents.set(setId, {id: parentId, quantity: line.quantity});
    }
  }

  // Pass 2: validate children and count each set before emitting operations.
  const candidates = [];
  for (const line of lines) {
    if (
      line.parentMarker?.value ||
      !line.parentVariantId?.value ||
      !validSet(line) ||
      line.merchandise?.__typename !== 'ProductVariant' ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) continue;

    const setId = line.setId.value;
    const parent = parents.get(setId);
    const childId = variantNumber(line.merchandise.id);

    if (
      !parent ||
      !childId ||
      childId === parent.id ||
      parent.id !== line.parentVariantId.value ||
      line.quantity !== parent.quantity
    ) continue;

    childCounts.set(setId, (childCounts.get(setId) || 0) + 1);
    candidates.push({line, setId});
  }

  const operations = [];
  for (const {line, setId} of candidates) {
    const count = childCounts.get(setId) || 0;
    // Require at least one child and cap pathological/tampered bundle sets.
    if (count < 1 || count > 20) continue;

    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        price: {
          adjustment: {
            fixedPricePerUnit: {amount: '0.00'},
          },
        },
      },
    });
  }

  return {operations};
}
