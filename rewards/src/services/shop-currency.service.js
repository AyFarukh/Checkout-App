import {shopifyAdminGraphql} from './shopify-admin.service.js';
const cache=new Map();
// Public metadata only: share in-flight lookups and never delay the wallet over a second.
export async function shopCurrencyCode(shop,graphql=shopifyAdminGraphql){
 const cached=cache.get(shop);if(cached?.code&&cached.expiresAt>Date.now())return cached.code;
 let entry=cached?.pending?cached:null;
 if(!entry){
  entry={code:null,expiresAt:0,pending:null};
  entry.pending=Promise.resolve().then(()=>graphql(shop,'query RewardsShopCurrency { shop { currencyCode } }')).then(result=>{
   const code=String(result?.shop?.currencyCode||'');if(!/^[A-Z]{3}$/.test(code))return null;
   entry.code=code;entry.expiresAt=Date.now()+300000;return code;
  }).catch(()=>null).finally(()=>{entry.pending=null;if(!entry.code&&cache.get(shop)===entry)cache.delete(shop);});
  if(cache.size>=250)cache.delete(cache.keys().next().value);cache.set(shop,entry);
 }
 let timer;
 try{return await Promise.race([entry.pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1000);})]);}
 finally{clearTimeout(timer);}
}
