import {actionError} from './loop-action-contract.service.js';

const shopPattern=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const validId=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value));
const productionShop=()=>typeof process.env.LOOP_ADMIN_SHOP==='string'&&shopPattern.test(process.env.LOOP_ADMIN_SHOP)?process.env.LOOP_ADMIN_SHOP:null;

export function loopMutationsEnabled() {
 if(process.env.NODE_ENV==='production')return process.env.LOOP_PRODUCTION_MUTATIONS_ENABLED==='true'&&productionShop()!==null;
 return ['test','development'].includes(process.env.NODE_ENV)&&process.env.LOOP_TEST_MUTATIONS_ENABLED==='true';
}

// Scope is derived only from the authenticated identity. Ownership and the active
// installation are checked by the executor before preview, execute and status.
// Scope remains available when writes are off so pending outcomes can be read.
export function subscriptionActionScope(identity,subscriptionId) {
 const {shop,customerId}=identity||{};
 if(typeof shop!=='string'||!shopPattern.test(shop)||!validId(customerId))throw actionError('SIGN_IN_REQUIRED',401);
 if(!validId(subscriptionId))throw actionError('INVALID_SUBSCRIPTION_ID');
 if(process.env.NODE_ENV==='production') {
  if(shop!==productionShop())throw actionError('STORE_NOT_AUTHORIZED',403);
 }else if(shop!==process.env.LOOP_TEST_SHOP||customerId!==process.env.LOOP_TEST_CUSTOMER_ID||subscriptionId!=='42347174'||process.env.LOOP_TEST_SUBSCRIPTION_ID!=='42347174')throw actionError('TEST_ONLY',403);
 return {shop,customerId,subscriptionId};
}

export function subscriptionMutationAllowed(identity,subscriptionId) {
 if(!loopMutationsEnabled())return false;
 try{subscriptionActionScope(identity,subscriptionId);return true;}catch{return false;}
}

export function subscriptionWriteAllowed(pathname,bound) {
 return subscriptionMutationAllowed(bound,bound?.subscriptionId)&&
  typeof pathname==='string'&&/^subscription\/[1-9]\d*\/[a-zA-Z0-9/-]+$/.test(pathname)&&
  pathname.startsWith(`subscription/${bound.subscriptionId}/`);
}
