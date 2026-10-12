/**
 * FTR dynamic bundle pricing.
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
 * Child products are intentionally dynamic. No product metafield allow-list is
 * required. Matching children receive a fixed per-unit price of 0.00.
 */
function variantNumber(gid) {
  return typeof gid === 'string' && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(gid)
    ? gid.split('/').pop()
    : null;
}

export function run(input) {
  const lines = input?.cart?.lines || [];
  const parents = new Map();

  for (const line of lines) {
    if (
      line.parentMarker?.value !== 'true' ||
      !line.setId?.value ||
      line.bundleId?.value !== line.setId.value ||
      line.merchandise?.__typename !== 'ProductVariant' ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) continue;

    const parentId = variantNumber(line.merchandise.id);
    if (!parentId) continue;

    const setId = line.setId.value;
    if (parents.has(setId)) {
      // Ambiguous/duplicate parent: invalidate this set.
      parents.set(setId, null);
    } else {
      parents.set(setId, {id: parentId, quantity: line.quantity});
    }
  }

  const operations = [];

  for (const line of lines) {
    if (
      !line.parentVariantId?.value ||
      !line.setId?.value ||
      line.bundleId?.value !== line.setId.value ||
      line.merchandise?.__typename !== 'ProductVariant'
    ) continue;

    const parent = parents.get(line.setId.value);
    if (
      !parent ||
      parent.id !== line.parentVariantId.value ||
      line.quantity !== parent.quantity
    ) continue;

    const childId = variantNumber(line.merchandise.id);
    if (!childId || childId === parent.id) continue;

    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: '0.00',
            },
          },
        },
      },
    });
  }

  return {operations};
}
