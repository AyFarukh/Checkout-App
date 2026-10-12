import {describe, expect, it} from 'vitest';
import {run} from './run';

const gid = (id: string) => `gid://shopify/ProductVariant/${id}`;
const set = 'set-test-12345678';

function parent(changes: Record<string, unknown> = {}) {
  return {
    id: 'parent-line', quantity: 1,
    parentMarker: {value: 'true'}, setId: {value: set}, bundleId: {value: set},
    parentVariantId: null,
    merchandise: {__typename: 'ProductVariant', id: gid('1')},
    ...changes,
  };
}
function child(id: string, changes: Record<string, unknown> = {}) {
  return {
    id: 'line-' + id, quantity: 1, parentMarker: null,
    setId: {value: set}, bundleId: {value: set}, parentVariantId: {value: '1'},
    merchandise: {__typename: 'ProductVariant', id: gid(id)},
    ...changes,
  };
}
function execute(lines: unknown[]) {
  return run({cart: {lines}} as Parameters<typeof run>[0]);
}
const zero = (id: string) => ({
  lineUpdate: {
    cartLineId: 'line-' + id,
    price: {adjustment: {fixedPricePerUnit: {amount: '0.00'}}},
  },
});

describe('FTR dynamic bundle child pricing', () => {
  it('does nothing on an empty cart', () =>
    expect(execute([])).toEqual({operations: []}));

  it('sets arbitrary dynamic children to zero and leaves parent unchanged', () =>
    expect(execute([parent(), child('2'), child('999'), child('12345')]))
      .toEqual({operations: [zero('2'), zero('999'), zero('12345')]}));

  it('rejects a child with a different set', () =>
    expect(execute([parent(), child('2', {setId: {value: 'different'}})]))
      .toEqual({operations: []}));

  it('rejects a child with a different bundle ID', () =>
    expect(execute([parent(), child('2', {bundleId: {value: 'different'}})]))
      .toEqual({operations: []}));

  it('rejects a child whose parent ID does not match', () =>
    expect(execute([parent(), child('2', {parentVariantId: {value: '999'}})]))
      .toEqual({operations: []}));

  it('rejects duplicate parents for one set', () =>
    expect(execute([parent(), parent(), child('2')]))
      .toEqual({operations: []}));

  it('rejects mismatched quantities', () =>
    expect(execute([parent(), child('2', {quantity: 2})]))
      .toEqual({operations: []}));

  it('never makes the parent variant a free child', () =>
    expect(execute([parent(), child('1')]))
      .toEqual({operations: []}));

  it('rejects malformed set identifiers', () =>
    expect(execute([
      parent({setId: {value: 'bad'}, bundleId: {value: 'bad'}}),
      child('2', {setId: {value: 'bad'}, bundleId: {value: 'bad'}}),
    ])).toEqual({operations: []}));

  it('rejects a line that claims to be both parent and child', () =>
    expect(execute([parent(), child('2', {parentMarker: {value: 'true'}})]))
      .toEqual({operations: []}));

  it('caps a bundle set at 20 child lines', () => {
    const children = Array.from({length: 21}, (_, i) => child(String(i + 2)));
    expect(execute([parent(), ...children])).toEqual({operations: []});
  });
});
