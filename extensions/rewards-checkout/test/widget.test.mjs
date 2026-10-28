import test from 'node:test';import assert from 'node:assert/strict';
import {signal} from '@preact/signals';
import {parseHTML} from 'linkedom';import {createElement as h,render} from 'preact';import {act} from 'preact/test-utils';
import {CheckoutRewards} from '../src/CheckoutRewards.js';
const {document,window}=parseHTML('<html><body></body></html>');Object.assign(globalThis,{document,window});
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const rewards=[1200,975,750,600,475,350,250,1800].map((pointsCost,index)=>({_id:String(pointsCost),name:'Discount',type:'FIXED_DISCOUNT',pointsCost,discountValue:[50,40,30,25,20,15,10,75][index],version:1,shopifySync:{status:'SYNCED',syncedVersion:1}}));
const fixture=()=>({currencyCode:'USD',customer:{pointsBalance:1240,lifetimeEarned:2100},rules:[{type:'PURCHASE',pointsPerDollar:1,multiplier:1}],rewards,redemptions:[]});
const api=(canUpdate=true)=>({settings:{value:{api_base_url:'https://rewards.example'}},buyerIdentity:{customer:{value:{id:'gid://shopify/Customer/1'}}},checkoutToken:{value:'test-checkout'},sessionToken:{get:async()=> 'test-session'},cost:{subtotalAmount:{value:{amount:74,currencyCode:'USD'}}},instructions:{value:{discounts:{canUpdateDiscountCodes:canUpdate}}},discountCodes:signal([])});
async function mount(){const root=document.createElement('div');document.body.append(root);await act(()=>render(h(CheckoutRewards),root));await flush();return root;}
async function click(node){assert.ok(node,'action exists');await act(()=>node.click());await flush();}
const find=(root,label)=>[...root.querySelectorAll('s-clickable,s-button')].find(node=>node.textContent===label);

test('checkout expands seven eligible discounts and recovers a reserved code after apply failure',async t=>{
 const originalFetch=globalThis.fetch;const profile=fixture();globalThis.shopify=api();let reservations=0,applications=0;
 globalThis.fetch=async(url)=>{if(url.endsWith('/me'))return {ok:true,json:async()=>structuredClone(profile)};reservations++;profile.customer.pointsBalance=40;return {ok:true,json:async()=>({redemption:{status:'RESERVED',discountCode:'TEST-ONLY',expiresAt:'2099-01-01'}})};};
 globalThis.shopify.applyDiscountCodeChange=async()=>{if(++applications===1)return {type:'error',message:'Discount could not be added'};globalThis.shopify.discountCodes.value=[{code:'TEST-ONLY'}];return {type:'success'};};
 let root;try{
  root=await mount();assert.ok(['fill','auto'].includes(root.querySelector('s-image').getAttribute('inlineSize')),'checkout image sizing must use a supported Shopify value');assert.match(root.textContent,/560 points away from \$75 off your next order/);assert.match(root.textContent,/Estimated 74 points/);
  const tiles=()=>[...root.querySelectorAll('s-clickable')].filter(n=>n.getAttribute('accessibilityLabel')?.startsWith('Redeem '));assert.equal(tiles().length,3);
  await click(find(root,'See all 7 rewards you qualify for'));assert.equal(tiles().length,7);
  await click(find(root,'Show fewer'));assert.equal(tiles().length,3);
  await click(tiles()[0]);assert.equal(reservations,1);assert.match(root.textContent,/Discount could not be added/);assert.match(root.textContent,/TEST-ONLY/);
  await click(find(root,'Apply reserved reward'));assert.equal(reservations,1,'retrying apply must not reserve again');assert.equal(applications,2);assert.match(root.textContent,/Reward code added to checkout/);
  await act(()=>{globalThis.shopify.discountCodes.value=[];});await flush();assert.ok(find(root,'Apply reserved reward'),'removing the code in checkout must allow reapplying it');
 }finally{if(root){await act(()=>render(null,root));root.remove();}globalThis.fetch=originalFetch;}
});
test('checkout disallowing discount changes cannot reserve points',async()=>{
 const originalFetch=globalThis.fetch;globalThis.shopify=api(false);let reservations=0;
 globalThis.fetch=async(url)=>{if(!url.endsWith('/me'))reservations++;return {ok:true,json:async()=>fixture()};};let root;
 try{root=await mount();assert.match(root.textContent,/Rewards cannot be changed/);const tile=root.querySelector('s-clickable');await click(tile);assert.equal(reservations,0);}finally{if(root){await act(()=>render(null,root));root.remove();}globalThis.fetch=originalFetch;}
});
test('lost response plus remount reuses the request and blocks a provisioning reservation',async()=>{
 const originalFetch=globalThis.fetch;globalThis.shopify=api();const profile=fixture(),keys=[];let applications=0;
 globalThis.shopify.applyDiscountCodeChange=async()=>{applications++;return {type:'success'};};
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/me'))return {ok:true,json:async()=>structuredClone(profile)};
  keys.push(options.headers['Idempotency-Key']);
  if(keys.length===1)throw new Error('Response lost');
  const reservation={status:'RESERVED',publicReference:'stable-reference',expiresAt:'2099-01-01'};profile.redemptions=[reservation];return {ok:true,json:async()=>({redemption:reservation})};
 };let root;
 try{
  root=await mount();await click(root.querySelector('s-clickable'));await act(()=>render(null,root));root.remove();root=await mount();
  await click(root.querySelector('s-clickable'));assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.match(root.textContent,/Preparing your reward/);
  assert.equal(root.querySelector('s-clickable'),null,'no new reward can be selected while provisioning');assert.equal(applications,0);
  profile.redemptions[0].discountCode='RECOVERED';await click(find(root,'Check again'));assert.doesNotMatch(root.textContent,/Preparing your reward/);assert.ok(find(root,'Apply reserved reward'));assert.equal(keys.length,2);
 }finally{if(root){await act(()=>render(null,root));root.remove();}globalThis.fetch=originalFetch;}
});
test('a reserve response from the previous buyer is never applied to the new buyer',async()=>{
 const originalFetch=globalThis.fetch;globalThis.shopify=api();globalThis.shopify.buyerIdentity.customer=signal({id:'gid://shopify/Customer/1'});let finish,applications=0;
 globalThis.shopify.applyDiscountCodeChange=async()=>{applications++;return {type:'success'};};
 globalThis.fetch=async(url)=>url.endsWith('/me')?{ok:true,json:async()=>fixture()}:new Promise(resolve=>{finish=resolve;});let root;
 try{
  root=await mount();await click(root.querySelector('s-clickable'));assert.ok(finish);
  await act(()=>{globalThis.shopify.buyerIdentity.customer.value={id:'gid://shopify/Customer/2'};});await flush();
  finish({ok:true,json:async()=>({redemption:{status:'RESERVED',discountCode:'OLD-BUYER',expiresAt:'2099-01-01'}})});await flush();
  assert.equal(applications,0);assert.doesNotMatch(root.textContent,/OLD-BUYER/);
 }finally{if(root){await act(()=>render(null,root));root.remove();}globalThis.fetch=originalFetch;}
});
test('an old buyer refresh cannot unlock a new buyer reservation',async()=>{
 const originalFetch=globalThis.fetch;globalThis.shopify=api();globalThis.shopify.buyerIdentity.customer=signal({id:'gid://shopify/Customer/1'});let walletCalls=0,reservations=0,finishOldRefresh,finishNewReservation;
 globalThis.shopify.applyDiscountCodeChange=async()=>({type:'success'});
 globalThis.fetch=async(url)=>{
  if(url.endsWith('/me')){walletCalls++;if(walletCalls===2)return new Promise(resolve=>{finishOldRefresh=resolve;});return {ok:true,json:async()=>fixture()};}
  reservations++;if(reservations===1)return {ok:true,json:async()=>({redemption:{status:'RESERVED',discountCode:'OLD',expiresAt:'2099-01-01'}})};
  return new Promise(resolve=>{finishNewReservation=resolve;});
 };let root;
 try{
  root=await mount();await click(root.querySelector('s-clickable'));assert.ok(finishOldRefresh);
  await act(()=>{globalThis.shopify.buyerIdentity.customer.value={id:'gid://shopify/Customer/2'};});await flush();
  await click(root.querySelector('s-clickable'));assert.equal(reservations,2);
  finishOldRefresh({ok:true,json:async()=>fixture()});await flush();await click(root.querySelectorAll('s-clickable')[1]);assert.equal(reservations,2,'old cleanup must not unlock the new reservation');
  finishNewReservation({ok:true,json:async()=>({redemption:{status:'RESERVED',discountCode:'NEW',expiresAt:'2099-01-01'}})});await flush();
 }finally{if(root){await act(()=>render(null,root));root.remove();}globalThis.fetch=originalFetch;}
});
