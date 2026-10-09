/**
 * Safe default for migrated Cart Transform.
 *
 * The original function used an invalid hard-coded parent variant and the
 * removed `merge` operation. Do not merge customer lines until a merchant-owned
 * bundle configuration supplies a verified parent variant and component rules.
 *
 * Shopify 2026-07 accepts `linesMerge`, `lineExpand`, and `lineUpdate`.
 * Returning no operations preserves checkout prices and line items.
 */
export function run(_input: unknown) {
  return {operations: []};
}
