import {describe, expect, it} from 'vitest';
import {run} from './run';

const gid = (id: string) => `gid://shopify/ProductVariant/${id}`;
const set = 'set-test-123';
function parent(allowed: unknown = ['2', '3']) {
  return {id: 'parent-line', quantity: 1,
    parentMarker: {value: 'true'}, setId: {value: set}, bundleId: {value: set},
    parentVariantId: null,
    merchandise: {__typename: 'ProductVariant', id: gid('1'),
      product: {bundleChildren: {jsonValue: allowed}}}};
}
function child(id: string, changes: Record<string, unknown> = {}) {
  return {id: 'line-' + id, quantity: 1, parentMarker: null,
    setId: {value: set}, bundleId: {value: set}, parentVariantId: {value: '1'},
    merchandise: {__typename: 'ProductVariant', id: gid(id), product: {bundleChildren: null}},
    ...changes};
}
function execute(lines: unknown[]) {
  return run({cart: {lines}} as Parameters<typeof run>[0]);
}
describe('FTR bundle child pricing', () => {
  it('does nothing on an empty cart', () => expect(execute([])).toEqual({operations: []}));
  it('sets configured children to zero while leaving parent unchanged', () => {
    expect(execute([parent(), child('2'), child('3')])).toEqual({operations: [
      {lineUpdate: {cartLineId: 'line-2', price: {adjustment: {fixedPricePerUnit: {amount: '0.00'}}}}},
      {lineUpdate: {cartLineId: 'line-3', price: {adjustment: {fixedPricePerUnit: {amount: '0.00'}}}}},
    ]});
  });
  it('rejects unconfigured children', () => expect(execute([parent(), child('999')])).toEqual({operations: []}));
  it('rejects forged attributes without merchant metafield', () => expect(execute([parent(null), child('2')])).toEqual({operations: []}));
  it('rejects mismatched set', () => expect(execute([parent(), child('2', {setId: {value: 'different'}})])).toEqual({operations: []}));
  it('rejects mismatched parent ID', () => expect(execute([parent(), child('2', {parentVariantId: {value: '999'}})])).toEqual({operations: []}));
  it('rejects duplicate parent lines', () => expect(execute([parent(), parent(), child('2')])).toEqual({operations: []}));
  it('rejects mismatched quantities', () => expect(execute([parent(), child('2', {quantity: 2})])).toEqual({operations: []}));
});
