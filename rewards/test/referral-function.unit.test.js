import test from 'node:test';
import assert from 'node:assert/strict';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/rewards-discount/src/cart_lines_discounts_generate_run.js';

const customerId = 'gid://shopify/Customer/1';
const variantId = 'gid://shopify/ProductVariant/1';
const productId = 'gid://shopify/Product/1';
const friend = { referralFirstOrder: true, type: 'FIXED_DISCOUNT', shopifyCustomerId: customerId, discountValue: 10, minimumSpend: 20 };
const gift = { referralGift: true, type: 'FREE_PRODUCT', shopifyCustomerId: customerId, variantId, giftQuantity: 3 };
function input(cfg, orders = 0) {
  return { presentmentCurrencyRate: '1', cart: { buyerIdentity: { isAuthenticated: true, customer: { id: customerId, numberOfOrders: orders } }, cost: { subtotalAmount: { amount: '100' } }, lines: [{ id: 'gid://shopify/CartLine/1', quantity: 2, merchandise: { id: variantId, product: { id: productId } } }, { id: 'gid://shopify/CartLine/2', quantity: 5, merchandise: { id: variantId, product: { id: productId } } }] }, discount: { discountClasses: ['ORDER', 'PRODUCT'], metafield: { jsonValue: cfg } } };
}
const empty = value => assert.deepEqual(run(value), { operations: [] });
test('friend discount requires strictly zero known prior orders', () => {
  assert.equal(run(input(friend)).operations.length, 1);
  for (const count of [1, -1, 0.1, '0', null]) empty(input(friend, count));
  const missing = input(friend); delete missing.cart.buyerIdentity.customer.numberOfOrders; empty(missing);
});
test('all referrals require the authenticated configured customer', () => {
  for (const cfg of [friend, gift]) {
    const wrong = input(cfg); wrong.cart.buyerIdentity.customer.id = 'gid://shopify/Customer/2'; empty(wrong);
    const missing = input(cfg); delete missing.cart.buyerIdentity; empty(missing);
    const guest = input(cfg); guest.cart.buyerIdentity.isAuthenticated = false; empty(guest);
    empty(input({ ...cfg, shopifyCustomerId: '' }));
  }
});
test('gift caps quantity across split lines and permits existing customers', () => {
  const result = run(input(gift, 8));
  assert.deepEqual(result.operations[0].productDiscountsAdd.candidates[0].targets, [{ cartLine: { id: 'gid://shopify/CartLine/1', quantity: 2 } }, { cartLine: { id: 'gid://shopify/CartLine/2', quantity: 1 } }]);
});
test('gift selects the exact variant and validates bounded quantities', () => {
  const wrong = input(gift); wrong.cart.lines.forEach(line => { line.merchandise.id = 'gid://shopify/ProductVariant/2'; }); empty(wrong);
  for (const quantity of [0, -1, 11, 1.5, '1', null, undefined]) empty(input({ ...gift, giftQuantity: quantity }));
  empty(input({ ...gift, variantId: productId }));
});
test('referral fixed values and minimum spend convert from shop to presentment currency', () => {
  const value = input(friend); value.presentmentCurrencyRate = '2'; value.cart.cost.subtotalAmount.amount = '39'; empty(value);
  value.cart.cost.subtotalAmount.amount = '40';
  assert.equal(run(value).operations[0].orderDiscountsAdd.candidates[0].value.fixedAmount.amount, 20);
  for (const rate of [0, -1, '', null, undefined, 'invalid']) { value.presentmentCurrencyRate = rate; empty(value); }
});
test('referral flags cannot be repurposed to other discount types', () => {
  empty(input({ ...friend, type: 'PERCENTAGE_DISCOUNT' }));
  empty(input({ ...gift, type: 'FIXED_DISCOUNT', discountValue: 100 }));
});
test('legacy fixed and product rewards retain their previous semantics', () => {
  const value = input({ type: 'FIXED_DISCOUNT', discountValue: 10, minimumSpend: 20 }); delete value.cart.buyerIdentity; value.presentmentCurrencyRate = '2';
  assert.equal(run(value).operations[0].orderDiscountsAdd.candidates[0].value.fixedAmount.amount, 10);
  value.discount.metafield.jsonValue = { type: 'FREE_PRODUCT', productId };
  assert.deepEqual(run(value).operations[0].productDiscountsAdd.candidates[0].targets, value.cart.lines.map(line => ({ cartLine: { id: line.id } })));
});
