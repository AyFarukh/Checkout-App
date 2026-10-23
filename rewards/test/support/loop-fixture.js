import http from 'node:http';
export function baseSubscription() {
 const date=new Date(Date.now()+10*86400000);date.setUTCHours(14,0,0,0);
 return {id:42347174,status:'ACTIVE',nextBillingDateEpoch:Math.floor(date.getTime()/1000),customer:{shopifyId:123},billingPolicy:{interval:'MONTH',intervalCount:1},deliveryPolicy:{interval:'MONTH',intervalCount:1},lineItems:[{id:7,quantity:1,productTitle:'Test product'}],shippingAddress:{firstName:'Test',lastName:'User',address1:'1 Test Road',city:'Boston',countryCode:'US',provinceCode:'MA',zip:'02108'},orderNote:'',discounts:[]};
}
export const actionCases=[['skip',{}],['reschedule',{date:new Date(Date.now()+20*86400000).toISOString().slice(0,10)}],['delay',{days:7}],['order-now',{preponeFutureOrder:true}],['frequency',{interval:'WEEK',intervalCount:2}],['pause',{confirmPause:true}],['cancel',{confirmCancellation:true}],['edit-products',{lineId:'7',quantity:2}],['edit-address',{...baseSubscription().shippingAddress,address1:'2 Test Road'}],['discount',{value:'TEST10'}],['order-note',{value:'Leave at the door'}]];
export async function startLoopFixture() {
 const fixture={reset(){this.subscription=baseSubscription();this.writes=[];this.history=[];this.schedule=[{id:1,status:'SCHEDULED',scheduledAt:new Date(this.subscription.nextBillingDateEpoch*1000).toISOString()}];this.owned=true;this.noStateChange=false;this.businessFailure=false;this.ambiguousFailure=false;this.writeDelay=0;}};
 fixture.reset();
 const server=http.createServer(async(req,res)=>{
  if(req.headers['x-loop-token']!=='fixture-only'){res.writeHead(401);return res.end('{"success":false}');}
  let raw='';for await(const chunk of req)raw+=chunk;
  const path=new URL(req.url,'http://fixture').pathname;
  let data;
  if(req.method==='GET'){
   if(path.endsWith('/product'))data=[{title:'Test catalog',productVariants:[{shopifyId:101,title:'New product',hasSellingPlan:true}]}];
   else if(path.includes('/customer/'))data=fixture.owned?[fixture.subscription]:[];
   else if(path.endsWith('/order/history'))data=fixture.history;
   else if(path.endsWith('/order/schedule'))data=fixture.schedule;
   else data=fixture.subscription;
  }else{
   const b=raw?JSON.parse(raw):{};fixture.writes.push({path,method:req.method,body:b});
   if(fixture.writeDelay)await new Promise(r=>setTimeout(r,fixture.writeDelay));
   if(!fixture.noStateChange&&!fixture.businessFailure){
    const s=fixture.subscription;
    if(path.endsWith('/skipNext')){s.nextBillingDateEpoch+=30*86400;fixture.schedule[0].status='SKIPPED';}
    else if(path.endsWith('/reschedule'))s.nextBillingDateEpoch=b.newBillingDateEpoch;
    else if(path.endsWith('/placeOrder'))fixture.history.push({id:99,shopifyId:100,status:'SUCCESS'});
    else if(path.endsWith('/frequency')){s.billingPolicy=b.billingPolicy;s.deliveryPolicy=b.deliveryPolicy;}
    else if(path.endsWith('/pause'))s.status='PAUSED';
    else if(path.endsWith('/cancel'))s.status='CANCELLED';
    else if(path.endsWith('/line/7/update'))s.lineItems[0].quantity=b.quantity;
    else if(path.endsWith('/line/7/swap'))s.lineItems[0]={...s.lineItems[0],variantShopifyId:b.variantShopifyId,quantity:b.quantity};
    else if(path.endsWith('/line/7')&&req.method==='DELETE')s.lineItems=s.lineItems.filter(l=>l.id!==7);
    else if(path.endsWith('/line')&&req.method==='POST')s.lineItems.push({id:8,variantShopifyId:b.variantShopifyId,quantity:b.quantity});
    else if(path.endsWith('/address'))s.shippingAddress=b;
    else if(path.endsWith('/discount'))s.discounts.push({node:{code:b.discountCode}});
    else if(path.endsWith('/note')){if(Object.hasOwn(s,'orderNote'))s.orderNote=b.note;else s.note=b.note;}
    else {res.writeHead(404);return res.end('{"success":false}');}
   }
   if(fixture.ambiguousFailure){res.writeHead(500);return res.end('{"success":false}');}
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:req.method==='GET'||!fixture.businessFailure,data:data??null}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fixture.url=`http://127.0.0.1:${server.address().port}/admin/2026-04`;
 fixture.close=()=>new Promise(r=>server.close(r));return fixture;
}
