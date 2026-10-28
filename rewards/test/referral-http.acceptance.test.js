import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { SignJWT } from 'jose';
import { referralCustomer, referralProxy } from '../src/routes/referralCustomer.js';
import { signed } from '../src/routes/welcomeVerification.js';
import { customerAuth } from '../src/middleware/customerAuth.js';
import { adminApi } from '../src/routes/adminApi.js';
import { errorHandler, requestId } from '../src/middleware/errorHandler.js';
import { ReferralProgram } from '../src/models/ReferralProgram.js';
import { ReferralAccount } from '../src/models/ReferralAccount.js';
import { ReferralClaim } from '../src/models/ReferralClaim.js';
import { ReferralEntitlement } from '../src/models/ReferralEntitlement.js';
import { RewardCustomer } from '../src/models/RewardCustomer.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { defaultReferralProgram, normalizeReferralProgram } from '../src/services/referral-program.service.js';

test('referral HTTP routes bind signed identities and gate activation', { skip: !process.env.MONGODB_URI }, async t => {
  const previous = { ...process.env };
  const suffix = `${Date.now()}-${process.pid}`;
  const shop = `referral-http-${suffix}.myshopify.com`, otherShop = `other-http-${suffix}.myshopify.com`;
  const customerId = 'gid://shopify/Customer/101', otherCustomerId = 'gid://shopify/Customer/202';
  const models = [ReferralProgram, ReferralAccount, ReferralClaim, ReferralEntitlement, RewardCustomer, AdminAuditLog];
  let server;
  const nativeFetch = globalThis.fetch;
  process.env.SHOPIFY_API_KEY = 'referral-http-key';
  process.env.SHOPIFY_API_SECRET = 'referral-http-secret';
  process.env.SHOPIFY_OFFLINE_TOKENS_JSON = JSON.stringify({ [shop]: 'test-only-token' });
  process.env.SHOPIFY_REWARDS_FUNCTION_ID = 'test-only-function';
  delete process.env.REFERRALS_FUNCTION_V2_READY;
  let shopifyCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.hostname === '127.0.0.1') return nativeFetch(url, options);
    assert.equal(target.hostname, shop, 'all external requests must be mocked for this test shop');
    assert.equal(options.headers['X-Shopify-Access-Token'], 'test-only-token');
    const { query, variables } = JSON.parse(options.body); shopifyCalls++;
    if (query.includes('query RewardsFunction(')) return Response.json({ data: { shopifyFunction: { id: variables.id, title: 'FreeTheRoots Rewards Discount', apiType: 'discount' } } });
    if (query.includes('query ReferralShop')) return Response.json({ data: { shop: { currencyCode: 'USD', primaryDomain: { url: `https://${shop}` } } } });
    assert.fail(`Unexpected Shopify operation: ${query}`);
  });
  async function token(destShop = shop, subject = customerId, admin = false) {
    return new SignJWT({ dest: `https://${destShop}`, sub: subject }).setProtectedHeader({ alg: 'HS256' }).setIssuer(`https://${destShop}${admin ? '/admin' : ''}`).setAudience('referral-http-key').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('referral-http-secret'));
  }
  function proxyQuery(id = '101') {
    const query = { shop, logged_in_customer_id: id, path_prefix: '/apps/ftr-welcome', timestamp: String(Math.floor(Date.now() / 1000)) };
    query.signature = createHmac('sha256', 'referral-http-secret').update(Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('')).digest('hex');
    assert.equal(signed(query), true);
    return new URLSearchParams(query).toString();
  }
  async function request(path, { jwt, method = 'GET', body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text, headers: response.headers };
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || undefined });
    await Promise.all(models.map(model => model.init()));
    const draft = defaultReferralProgram();
    for (const milestone of draft.milestones.filter(m => m.kind === 'PRODUCT')) Object.assign(milestone, { productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/1' });
    await ReferralProgram.create({ ...normalizeReferralProgram(draft), shop, revision: 7, liveEnabled: false });
    await RewardCustomer.create([{ shop, shopifyCustomerId: customerId, referralDebt: 11 }, { shop, shopifyCustomerId: otherCustomerId, referralDebt: 22 }, { shop: otherShop, shopifyCustomerId: customerId, referralDebt: 33 }]);
    const app = express(); app.use(express.json(), requestId);
    app.use('/customer', customerAuth, referralCustomer); app.use('/proxy', referralProxy(signed)); app.use('/api/admin', adminApi); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const jwt = await token(), admin = await token(shop, 'admin-test-user', true);
    await t.test('native customer JWT shop and subject determine the profile', async () => {
      assert.equal((await request('/customer/me')).status, 401);
      assert.equal((await request('/customer/me', { jwt: admin })).status, 401);
      const own = await request(`/customer/me?shop=${otherShop}&customerId=${otherCustomerId}`, { jwt });
      assert.equal(own.status, 200); assert.equal(own.body.referralDebt, 11); assert.equal(own.body.enabled, false);
      assert.equal((await request('/customer/me', { jwt: await token(shop, otherCustomerId) })).body.referralDebt, 22);
      assert.equal((await request('/customer/me', { jwt: await token(otherShop) })).body.referralDebt, 33);
      assert.equal(shopifyCalls, 0, 'inactive profiles require no Shopify calls');
    });
    await t.test('proxy authenticates signed query and permits only the guest HTML shell', async () => {
      assert.equal((await request('/proxy/me')).status, 403);
      const guest = await request(`/proxy/?${proxyQuery('')}`); assert.equal(guest.status, 200); assert.match(guest.body, /<!doctype html>/i);
      assert.equal((await request(`/proxy/me?${proxyQuery('')}`)).status, 401);
      const own = await request(`/proxy/me?${proxyQuery()}`); assert.equal(own.status, 200); assert.equal(own.body.referralDebt, 11);
      assert.match(own.headers.get('cache-control'), /private.*no-store/);
      assert.equal((await request(`/proxy/me?${proxyQuery()}&logged_in_customer_id=202`)).status, 403);
    });
    await t.test('inactive claim routes fail closed despite spoofed body identity', async () => {
      const body = { shop: otherShop, customerId: otherCustomerId, code: 'A'.repeat(24) };
      for (const [path, auth] of [['/customer/claim', jwt], [`/proxy/claim?${proxyQuery()}`, undefined]]) assert.equal((await request(path, { jwt: auth, method: 'POST', body })).status, 409);
      assert.equal(await ReferralClaim.countDocuments({ shop: { $in: [shop, otherShop] } }), 0);
      assert.equal(shopifyCalls, 0);
    });
    await t.test('activation requires admin authentication, readiness and the current revision', async () => {
      const path = '/api/admin/referrals/activation', body = { enabled: true, revision: 7, confirm: true, shop: otherShop };
      assert.equal((await request(path, { method: 'POST', body })).status, 401);
      assert.equal((await request(path, { jwt: admin, method: 'POST', body })).status, 409);
      assert.equal(shopifyCalls, 0);
      process.env.REFERRALS_FUNCTION_V2_READY = '1';
      assert.equal((await request(path, { jwt: admin, method: 'POST', body: { ...body, revision: 6 } })).status, 409);
      const activated = await request(path, { jwt: admin, method: 'POST', body });
      assert.equal(activated.status, 200); assert.equal(activated.body.status, 'ACTIVE'); assert.equal(activated.body.program.revision, 8); assert.equal(activated.body.program.shop, shop);
      assert.equal(await ReferralProgram.countDocuments({ shop: otherShop }), 0);
      assert.equal((await request(path, { jwt: admin, method: 'POST', body })).status, 409);
      assert.equal(await AdminAuditLog.countDocuments({ shop, 'metadata.activation': true }), 1);
    });
    await t.test('active claims cannot replace native or proxy identity from the request body', async () => {
      const ownCode = 'B'.repeat(24);
      await ReferralAccount.create({ shop, customerId, code: ownCode });
      const body = { shop: otherShop, customerId: otherCustomerId, shopifyCustomerId: otherCustomerId, code: ownCode };
      for (const [path, auth] of [['/customer/claim', jwt], [`/proxy/claim?${proxyQuery()}`, undefined]]) {
        const result = await request(path, { jwt: auth, method: 'POST', body });
        assert.equal(result.status, 400); assert.match(result.body.error.message, /not your own/);
      }
      assert.equal(await ReferralClaim.countDocuments({ shop: { $in: [shop, otherShop] } }), 0);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await Promise.all(models.map(model => model.collection.deleteMany({ shop: { $in: [shop, otherShop] } })));
    await mongoose.disconnect(); process.env = previous;
  }
});
