import test from 'node:test';import assert from 'node:assert/strict';
import {shopCurrencyCode} from '../src/services/shop-currency.service.js';
test('public currency cache remains shop scoped and avoids repeated Shopify requests',async()=>{
 let calls=0;const graphql=async(shop,query)=>{calls++;assert.match(query,/currencyCode/);return {shop:{currencyCode:shop.startsWith('currency-a')?'USD':'CAD'}};};
 assert.equal(await shopCurrencyCode('currency-a.myshopify.com',graphql),'USD');
 assert.equal(await shopCurrencyCode('currency-a.myshopify.com',graphql),'USD');
 assert.equal(await shopCurrencyCode('currency-b.myshopify.com',graphql),'CAD');assert.equal(calls,2);
});
test('failed currency lookup never blocks the wallet and is retried',async()=>{
 const shop='currency-fail.myshopify.com';assert.equal(await shopCurrencyCode(shop,async()=>{throw new Error('Unavailable');}),null);
 assert.equal(await shopCurrencyCode(shop,async()=>({shop:{currencyCode:'INVALID'}})),null);
 assert.equal(await shopCurrencyCode(shop,async()=>({shop:{currencyCode:'GBP'}})),'GBP');
});
