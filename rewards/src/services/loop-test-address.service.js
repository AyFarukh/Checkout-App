import {normalizeAction,actionError} from './loop-action-contract.service.js';

// Local fixture preparation only. Never logs the address or mutates the input.
export function prepareAddressTestFixture(subscription){
 if(String(subscription?.id)!=='42347174'||!subscription.shippingAddress)
  throw actionError('ORIGINAL_ADDRESS_UNAVAILABLE');
 const keys=['firstName','lastName','company','phone','address1','address2','city','countryCode','provinceCode','zip'];
 const original=normalizeAction('edit-address',Object.fromEntries(keys.map(k=>[k,subscription.shippingAddress[k]??''])));
 const marker='FreeTheRoots integration test';
 const payload={...original,address2:original.address2===marker?marker+' (2)':marker};
 return {original,payload};
}
