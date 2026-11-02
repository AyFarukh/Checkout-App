(()=>{'use strict';const root=document.querySelector('[id^="ftr-subscription-dashboard-"]');if(!root||!root.querySelector('.ftr-sub__loading'))return;const main=root.querySelector('.ftr-sub__main'),endpoint=root.dataset.endpoint;const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n};const add=(parent,...children)=>{for(const child of children)if(child)parent.append(child);return parent};const pick=(o,...keys)=>keys.map(k=>o?.[k]).find(v=>v!==undefined&&v!==null&&v!=='');const number=v=>{if(v==null||v==='')return null;if(typeof v==='object')return number(pick(v,'amount','value','price','total'));const n=Number(String(v).replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:null};const money=(v,c)=>v==null?'Price unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(v);const date=v=>{if(v===null||v===undefined||v==='')return'Not scheduled';const raw=String(v);const d=(typeof v==='number'||/^\d{10,13}$/.test(raw))?new Date(Number(v)*(Number(v)<1e12?1000:1)):new Date(v);return Number.isNaN(d.getTime())?'Not scheduled':d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})};const img=v=>typeof v==='string'?v:pick(v,'url','src','originalSrc')||'';const lines=s=>[s.lines,s.lineItems,s.subscriptionLines,s.items,s.products,s.subscriptionProducts].find(Array.isArray)||[];const card=(title,id)=>{const n=el('section','ftr-sub__card');if(id)n.id=id;if(title)add(n,el('h2','',title));return n};const btn=(label,primary=false,action=label)=>{const b=el('button','ftr-sub__btn'+(primary?' ftr-sub__btn--primary':''),label);b.type='button';if(mutationAccess===false&&actionMap[action]&&actionMap[action]!=='gift'){b.disabled=true;b.title='Subscription changes are currently disabled.';}b.addEventListener('click',()=>confirmAction(action));return b};let selectedSubscription=null,mutationAccess=false;
const actionMap={"Manage next order":"reschedule","Order now":"order-now","Skip":"skip","Skip next order":"skip","Reschedule":"reschedule","Change next order":"reschedule","Delay":"delay","Change frequency":"frequency","Pause subscription":"pause","Cancel subscription":"cancel","Edit products":"edit-products","Edit subscription":"edit-products","Edit address":"edit-address","Gift":"gift","Order notes":"order-note","Discount code":"discount"};
const pendingStorageKey=()=>`ftr-subscription-pending:${selectedSubscription?.id}`;
let pending=null;
function pendingRead(){try{return JSON.parse(localStorage.getItem(pendingStorageKey())||'null')}catch{return null}}
function pendingWrite(value){try{if(value)localStorage.setItem(pendingStorageKey(),JSON.stringify(value));else localStorage.removeItem(pendingStorageKey());pending=value;return true}catch{return false}}
async function actionRequest(path,body){
 const response=await fetch(endpoint+'/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 if(!(response.headers.get('content-type')||'').includes('application/json'))throw Error('Unexpected subscription service response. Check the status before submitting again.');
 const result=await response.json();return {response,result};
}
function confirmAction(label){
 const action=actionMap[label],trigger=document.activeElement;
 const selectors=[...root.querySelectorAll('[data-subscription-selector]')];for(const selector of selectors)selector.disabled=true;
 const backdrop=el('div','ftr-sub__dialog'),panel=el('div','ftr-sub__dialog-panel');
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',label);panel.tabIndex=-1;
 const form=el('form','ftr-sub__action-form'),status=el('p','ftr-sub__action-status');status.setAttribute('role','status');
 const inputs={},actions=el('div','ftr-sub__dialog-actions');let preview=null,busy=false,requestKey=crypto.randomUUID();
 const close=()=>{if(busy)return;backdrop.remove();document.removeEventListener('keydown',keys);for(const selector of selectors)if(selector.isConnected)selector.disabled=false;trigger?.focus();};
 const field=(key,title,type='text',values,initial='',required=true)=>{
  const wrapper=el('label','ftr-sub__action-field');add(wrapper,el('span','',title));let input;
  if(values){input=el('select');for(const [value,text] of values){const option=el('option','',text);option.value=String(value);input.append(option);}}
  else if(type==='textarea')input=el('textarea');else{input=el('input');input.type=type;}
  input.required=required;input.name=key;input.setAttribute('aria-label',title);
  if(type==='checkbox')input.checked=initial===true;else if(initial!==undefined)input.value=String(initial);
  if(type==='text'||type==='textarea')input.maxLength=key==='value'?500:255;
  inputs[key]=input;add(wrapper,input);add(form,wrapper);return input;
 };
 const readPayload=()=>{
  const p={};for(const [key,input] of Object.entries(inputs)){if(input.disabled)continue;p[key]=input.type==='checkbox'?input.checked:['days','quantity','intervalCount'].includes(key)?Number(input.value):input.value;}
  return p;
 };
 const review=el('button','ftr-sub__btn ftr-sub__btn--primary','Review change'),confirm=el('button','ftr-sub__btn ftr-sub__btn--primary','Confirm change'),check=el('button','ftr-sub__btn','Check status'),cancel=btnClose('Close',close);
 for(const b of [review,confirm,check])b.type='button';confirm.hidden=true;check.hidden=true;
 const invalidate=()=>{preview=null;confirm.hidden=true;review.hidden=false;status.textContent='Review your updated details before confirming.';};
 form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);form.addEventListener('submit',e=>e.preventDefault());
 if(action==='order-now')field('preponeFutureOrder','Place an immediate order','checkbox',undefined,false);
 if(action==='pause')field('confirmPause','Confirm pause','checkbox',undefined,false);
 if(action==='cancel')field('confirmCancellation','Confirm cancellation','checkbox',undefined,false);
 if(action==='reschedule'){const input=field('date','Choose a new date','date');input.min=new Date(Date.now()+86400000).toISOString().slice(0,10);}
 if(action==='delay')field('days','Delay delivery by','select',[[7,'7 days'],[14,'14 days'],[30,'30 days']],7);
 if(action==='frequency'){
  field('intervalCount','Every','select',[[1,'1'],[2,'2'],[3,'3'],[4,'4'],[6,'6']],selectedSubscription.billingPolicy?.intervalCount||1);
  field('interval','Period','select',[['MONTH','Months'],['WEEK','Weeks']],selectedSubscription.billingPolicy?.interval||'MONTH');
 }
 if(action==='edit-products'){
  field('operation','Product change','select',[['quantity','Change quantity'],['add','Add a product'],['swap','Swap a product'],['remove','Remove a product']],'quantity');
  const items=lines(selectedSubscription);
  field('lineId','Product','select',items.map(l=>[String(l.id),(l.productTitle||l.title||'Product')+' (current quantity '+l.quantity+')']),String(items[0]?.id||''));
  const quantity=field('quantity','Quantity','number',undefined,items[0]?.quantity||1);quantity.min='1';quantity.max='99';quantity.step='1';
  inputs.lineId.addEventListener('change',()=>{quantity.value=String(items.find(l=>String(l.id)===inputs.lineId.value)?.quantity||1);});
  const variant=field('variantShopifyId','New product','select',[]);variant.disabled=true;variant.parentElement.hidden=true;
  inputs.operation.addEventListener('change',async()=>{
   const op=inputs.operation.value;inputs.lineId.disabled=op==='add';inputs.lineId.parentElement.hidden=op==='add';quantity.disabled=op==='remove';quantity.parentElement.hidden=op==='remove';
   variant.disabled=!['add','swap'].includes(op);variant.parentElement.hidden=variant.disabled;
   if(!variant.disabled&&!variant.options.length){
    review.disabled=true;status.textContent='Loading subscription products…';
    try{const {response,result}=await actionRequest('action-catalog',{subscriptionId:String(selectedSubscription.id)});if(!response.ok||!result.ok)throw Error('Unable to load eligible products.');for(const product of result.products||[]){const option=el('option','',product.title);option.value=product.id;variant.append(option);}status.textContent=variant.options.length?'Choose a product and review your change.':'No eligible products available.';}catch(error){status.textContent=error.message;}finally{review.disabled=false;}
   }
  });
 }
 if(action==='edit-address'){
  const a=selectedSubscription.shippingAddress||{};
  for(const [key,title,required] of [['firstName','First name',true],['lastName','Last name',true],['company','Company',false],['phone','Phone',false],['address1','Address',true],['address2','Address line 2',false],['city','City',true],['countryCode','Country code',true],['provinceCode','State code',false],['zip','Postal code',false]])field(key,title,'text',undefined,a[key]||'',required);
  inputs.countryCode.pattern='[A-Z]{2}';inputs.countryCode.maxLength=2;
 }
 if(action==='discount')field('value','Discount code','text',undefined,'');
 if(action==='order-note')field('value','Order note','textarea',undefined,(Object.prototype.hasOwnProperty.call(selectedSubscription,'orderNote')?selectedSubscription.orderNote:selectedSubscription.note)||'',false);
 const note=el('p','ftr-sub__muted',action==='order-now'?'This places an order immediately and may charge your saved payment method.':action==='cancel'?'Cancellation stops future orders. Review carefully before confirming.':action==='pause'?'Pause until you resume through Loop.':action==='edit-products'?'Add, swap, remove a product or change its quantity. Loop sets the selling plan price. Bundles require Loop’s editor.':'Review your details. Changes are only available for the authorized test subscription.');
 add(actions,cancel,review,confirm,check);add(form,status);add(panel,el('h2','',label),note,form,actions);add(backdrop,panel);add(document.body,backdrop);
 function keys(e){
  if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){
   const focusable=[...panel.querySelectorAll('input,select,textarea,button')].filter(n=>!n.hidden&&!n.disabled),first=focusable[0],last=focusable.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }
 document.addEventListener('keydown',keys);backdrop.addEventListener('click',e=>{if(e.target===backdrop)close();});cancel.focus();
 const lock=()=>{review.hidden=true;confirm.hidden=true;check.hidden=false;for(const input of Object.values(inputs))input.disabled=true;};
 const resultMessage=result=>{status.textContent=result.message||result.code||'The change could not be verified.';};
 function rejected(result){
  pendingWrite(null);requestKey=crypto.randomUUID();
  for(const input of Object.values(inputs))input.disabled=false;
  if(action==='edit-products'){
   const op=inputs.operation.value;inputs.lineId.disabled=op==='add';inputs.quantity.disabled=op==='remove';inputs.variantShopifyId.disabled=!['add','swap'].includes(op);
  }
  check.hidden=true;invalidate();if(!mutationAccess){review.hidden=true;for(const input of Object.values(inputs))input.disabled=true;}resultMessage(result);
 }

 async function applied(result){
  pendingWrite(null);review.hidden=true;confirm.hidden=true;check.hidden=true;resultMessage(result);
  try{const response=await fetch(endpoint,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});if(!response.ok)throw Error();show(await response.json());busy=false;close();}
  catch{status.textContent='Your change was verified by Loop. Reload the page to refresh the dashboard.';}
 }
 review.addEventListener('click',async()=>{
  if(busy||!action||!selectedSubscription||!mutationAccess||!form.reportValidity())return;
  busy=true;review.disabled=true;status.textContent='Checking details…';
  const payload=readPayload();
  try{
   const {response,result}=await actionRequest('action-preview',{subscriptionId:String(selectedSubscription.id),action,payload,requestKey});
   if(!response.ok||!result.ok||!result.previewToken){resultMessage(result);return;}
   preview={payload:JSON.stringify(payload),token:result.previewToken};review.hidden=true;confirm.hidden=false;status.textContent=(result.message||'Review and confirm.')+(result.requestedBillingDateEpoch?' New billing date: '+date(result.requestedBillingDateEpoch)+'.':'');
  }catch(error){status.textContent=error.message;}finally{busy=false;review.disabled=false;}
 });
 confirm.addEventListener('click',async()=>{
  if(busy||!preview||!mutationAccess)return;
  if(JSON.stringify(readPayload())!==preview.payload){invalidate();return;}
  const body={subscriptionId:String(selectedSubscription.id),action,payload:readPayload(),requestKey,previewToken:preview.token,confirm:true};
  if(!pendingWrite({subscriptionId:body.subscriptionId,requestKey,action})){status.textContent='Browser storage is unavailable. Enable it before making a subscription change.';return;}
  busy=true;confirm.disabled=true;for(const input of Object.values(inputs))input.disabled=true;status.textContent='Submitting and verifying with Loop…';
  try{
   const {result}=await actionRequest('action-execute',body);
   if(result.applied===true&&result.verified===true){await applied(result);return;}
   // Explicit pre-dispatch/rejection codes allow a fresh review. Network errors and
   // unknown results retain the original key, including after a page reload.
   if(result.retrySafe===true||result.operationState==='rejected'){
    rejected(result);
   }else{lock();resultMessage(result);}
  }catch(error){lock();status.textContent='No confirmed result was received. Check status before making another change.';}
  finally{busy=false;confirm.disabled=false;}
 });
 check.addEventListener('click',async()=>{
  if(busy||!pending)return;busy=true;check.disabled=true;
  try{const {result}=await actionRequest('action-status',pending);if(result.applied===true&&result.verified===true)await applied(result);else if(result.operationState==='rejected')rejected(result);else resultMessage(result);}catch{status.textContent='Unable to check status. Your original request key is preserved.';}finally{busy=false;check.disabled=false;}
 });
 pending=pendingRead();
 if(pending){lock();status.textContent='A previous change is awaiting verification. Check its status before making another change.';}
 else if(action==='gift'){review.hidden=true;status.textContent='Loop has not published a gift-order API contract. Please use the Loop customer portal to gift an upcoming order.';}
 else if(!mutationAccess){review.hidden=true;status.textContent='Subscription changes are currently disabled.';}
 else if(!action){review.hidden=true;status.textContent='Manage this option through your Shopify account or the Loop customer portal.';}
}

function btnClose(t,fn){const b=el('button','ftr-sub__btn ftr-sub__btn--primary',t);b.type='button';b.addEventListener('click',fn);return b}function link(label,href,primary=false){const a=el('a','ftr-sub__btn'+(primary?' ftr-sub__btn--primary':''),label);a.href=href;return a;}
function orderView(subscriptionId,kind){
 const details=el('details','ftr-sub__order-view'),summary=el('summary','',kind==='schedule'?'Scheduled orders':'Past orders'),body=el('div','ftr-sub__order-body');
 body.setAttribute('data-testid','subscription-'+kind);add(details,summary,body);let loaded=false,loading=false;
 async function load(){
  if(loading||loaded)return;loading=true;body.replaceChildren(el('p','ftr-sub__muted','Loading orders…'));
  try{
   const {response,result}=await actionRequest('order-list',{subscriptionId:String(subscriptionId),kind});
   if(!response.ok||!result.ok||!Array.isArray(result.orders)||String(result.subscriptionId)!==String(subscriptionId))throw Error();
   if(!details.isConnected)return;
   body.replaceChildren();
   if(!result.orders.length)add(body,el('p','ftr-sub__muted',kind==='schedule'?'No scheduled orders.':'No past orders.'));
   for(const order of result.orders){
    const row=el('div','ftr-sub__order-row'),info=el('div');
    add(info,el('strong','',order.shopifyOrderNumber?'Order #'+order.shopifyOrderNumber:'Order #'+order.id),el('p','ftr-sub__muted',date(order.billingDate)));
    add(row,info,el('span','ftr-sub__badge',order.status||'Status unavailable'));add(body,row);
   }
   if(result.truncated)add(body,el('p','ftr-sub__muted','Showing the first 100 orders returned by Loop. Visit your account for further order details.'));
   loaded=true;
  }catch{
   if(!details.isConnected)return;
   const retry=el('button','ftr-sub__btn','Try again');retry.type='button';retry.addEventListener('click',load);
   body.replaceChildren(el('p','ftr-sub__error','Unable to load orders. Please try again.'),retry);
  }finally{loading=false;}
 }
 details.addEventListener('toggle',()=>{if(details.open)load();});return details;
}
function show(data,preferredId=selectedSubscription?.id){
 const subscriptions=(Array.isArray(data.subscriptions)?data.subscriptions:[]).filter(s=>s&&s.id!=null).slice().sort((a,b)=>(String(b.status).toUpperCase()==='ACTIVE')-(String(a.status).toUpperCase()==='ACTIVE'));
 const s=subscriptions.find(item=>String(item.id)===String(preferredId))||subscriptions[0];
 main.replaceChildren();selectedSubscription=s||null;pending=null;
 const accountUrl=root.dataset.accountUrl||'/account';
 const top=el('div','ftr-sub__topbar');add(top,link('Back to account',accountUrl),el('span','ftr-sub__muted','Subscription dashboard'));add(main,top);
 if(!s){add(main,card('No subscriptions found'));return;}
 mutationAccess=data.mutationsEnabled===true&&s.mutationAllowed===true;
 const chooser=card('Your subscriptions','ftr-subscription-list'),choices=el('div','ftr-sub__subscription-grid');
 for(const item of subscriptions){
  const b=el('button','ftr-sub__subscription-card');b.type='button';b.dataset.subscriptionSelector='';b.dataset.subscriptionId=String(item.id);
  b.setAttribute('aria-label',`View subscription #${item.id}`);b.setAttribute('aria-pressed',String(String(item.id)===String(s.id)));
  const status=String(item.status||'Unknown').toLowerCase(),names=lines(item).map(l=>pick(l,'productTitle','title','name')||'Subscription product');
  add(b,el('span','ftr-sub__badge',status),el('strong','',`Subscription #${item.id}`),el('span','ftr-sub__subscription-summary',names.slice(0,2).join(' · ')+(names.length>2?` +${names.length-2} more`:'')),el('span','ftr-sub__muted','Next order: '+date(item.nextOrderDateEpoch??item.nextBillingDateEpoch??pick(item,'nextBillingDate','nextOrderDate'))));
  b.addEventListener('click',()=>{show(data,item.id);[...root.querySelectorAll('[data-subscription-selector]')].find(node=>node.dataset.subscriptionId===String(item.id))?.focus();});add(choices,b);
 }
 add(chooser,choices);add(main,chooser);
 const identity=el('p','ftr-sub__subscription-id',`Subscription #${s.id}`);identity.setAttribute('data-testid','selected-subscription-id');
 const intro=el('header','ftr-sub__intro');add(intro,identity,el('h1','','Your subscription is '+String(s.status||'unknown').toLowerCase()),el('p','','Manage your products, schedule and delivery details.'));add(main,intro);
 pending=pendingRead();if(pending){
  const warning=el('div','ftr-sub__notice'),checkPending=el('button','ftr-sub__btn','Check pending change');checkPending.type='button';
  checkPending.addEventListener('click',()=>confirmAction(Object.entries(actionMap).find(([,action])=>action===pending.action)?.[0]||'Previous change'));
  add(warning,el('p','','A previous change is awaiting verification. Check its status before making another change.'),checkPending);add(main,warning);
 }
 if(!mutationAccess)add(main,el('p','ftr-sub__notice','Subscription changes are currently disabled. You can still view your details and orders.'));
 const items=lines(s),currency=pick(s,'currencyCode','currency')||'USD',freq=s.billingPolicy||s.frequency||{},address=s.shippingAddress||s.deliveryAddress||{};
 const lp=l=>number(pick(l,'discountedPrice','price','sellingPrice','linePrice','amount','unitPrice','sellingPriceAmount','discountedUnitPrice'))??number(pick(l.variant,'price','sellingPrice'));
 const total=number(pick(s,'totalLineItemDiscountedPrice','totalLineItemPrice','totalPrice','subtotalPrice','price','billingAmount','nextOrderTotal','nextBillingAmount'))??number(pick(s.nextOrder,'total','totalPrice','amount'))??(items.length&&items.every(l=>lp(l)!=null)?items.reduce((n,l)=>n+lp(l)*Number(l.quantity||1),0):null);
 const next=s.nextOrderDateEpoch??s.nextBillingDateEpoch??pick(s,'nextBillingDate','nextBillingAt','nextOrderDate','nextOrderAt','billingDate','nextOrderScheduledAt','nextChargeDate','nextOrderDateTime')??pick(s.nextOrder,'date','scheduledAt','billingDate');
 const nextCard=card('Next order','ftr-next'),grid=el('div','ftr-sub__next-grid'),info=el('div');
 add(info,el('div','ftr-sub__next-date',date(next)),el('p','ftr-sub__next-total',money(total,currency)),el('p','ftr-sub__muted','Products total · Delivery and taxes may be calculated separately'));
 const ul=el('ul','ftr-sub__products');for(const item of items)add(ul,el('li','',(pick(item,'productTitle','title','name')||'Subscription product')+' × '+(item.quantity||1)));add(info,ul);
 const hero=el('div','ftr-sub__hero'),first=items.map(l=>img(pick(l,'imageUrl','image','productImage','variantImage'))).find(Boolean);
 if(first){const image=el('img');image.src=first;image.alt='Subscription products';image.loading='lazy';add(hero,image);}else add(hero,el('span','ftr-sub__muted','Your subscription products'));
 add(grid,info,hero);add(nextCard,grid);const actions=el('div','ftr-sub__actions');
 for(const [label,primary]of [['Manage next order',true],['Order now'],['Gift'],['Skip'],['Reschedule'],['Delay']])add(actions,btn(label,primary));
 add(nextCard,actions,el('p','ftr-sub__muted','Gift orders are unavailable in this custom dashboard because Loop does not provide a gift-order API.'));add(main,nextCard);
 const columns=el('div','ftr-sub__columns'),sub=card('Your products','ftr-subscription');
 for(const item of items){
  const row=el('div','ftr-sub__product'),imageUrl=img(pick(item,'imageUrl','image','productImage','variantImage'));
  if(imageUrl){const image=el('img');image.src=imageUrl;image.loading='lazy';image.alt='';add(row,image);}else add(row,el('div','ftr-sub__product-placeholder'));
  const detail=el('div');add(detail,el('h3','',pick(item,'productTitle','title','name')||'Subscription product'),el('p','',money(lp(item),currency)+' · Quantity '+(item.quantity||1)));add(row,detail);add(sub,row);
 }
 add(sub,el('p','ftr-sub__muted','Delivery every '+(freq.intervalCount||freq.interval_count||1)+' '+String(freq.interval||'month').toLowerCase()),btn('Edit subscription'));
 const note=Object.prototype.hasOwnProperty.call(s,'orderNote')?s.orderNote:s.note;
 const notes=el('div','ftr-sub__detail-block'),noteText=el('p','',note||'No order note added.');noteText.dataset.testid='subscription-note';
 add(notes,el('h3','','Order note'),noteText,btn('Order notes'));add(sub,notes);
 const discounts=el('div','ftr-sub__detail-block'),discountText=el('p','',(s.discounts||[]).map(d=>d?.node||d).filter(d=>d&&d.isActive!==false&&!d.rejectionReason).map(d=>pick(d,'title','code','discountCode')||'Subscription discount').join(', ')||'No active discounts.');discountText.dataset.testid='subscription-discounts';
 add(discounts,el('h3','','Discounts'),discountText,btn('Discount code'));add(sub,discounts);
 const side=el('div','ftr-sub__stack'),shipping=card('Shipping address','ftr-address');
 const fullName=[address.firstName,address.lastName].filter(Boolean).join(' '),city=[address.city,address.province||address.provinceCode,address.zip].filter(Boolean).join(', ');
 add(shipping,el('p','ftr-sub__address',[fullName,address.company,address.address1,address.address2,city,address.country||address.countryCode].filter(Boolean).join('\n')||'No shipping address available.'),btn('Edit address'));
 const payment=card('Payment methods','ftr-payment');add(payment,el('p','ftr-sub__muted','Manage saved payment methods securely in your account portal.'),link('Manage payment methods in account',accountUrl,true));
 add(side,shipping,payment);add(columns,sub,side);add(main,columns);
 const orders=card('Your orders','ftr-orders');add(orders,orderView(s.id,'schedule'),orderView(s.id,'history'),link('View all orders in account',accountUrl));add(main,orders);
 const template=root.querySelector('[data-subscription-recommendations]');
 if(template?.content?.children.length){
  const recommended=template.content.cloneNode(true),existing=new Set(items.map(l=>String(l.variantShopifyId||l.variantId||l.shopifyVariantId||'')));
  for(const product of recommended.querySelectorAll('[data-variant-ids]')){try{if(JSON.parse(product.dataset.variantIds).some(id=>existing.has(String(id))))product.remove();}catch{product.remove();}}
  if(recommended.children.length){const rec=card('Complete your routine'),products=el('div','ftr-sub__recommend');add(products,recommended);add(rec,el('p','ftr-sub__muted','Explore more products for your routine.'),products);add(main,rec);}
 }
 const manage=card('Manage your subscription'),mg=el('div','ftr-sub__manage');
 for(const [icon,label,description]of [['◇','Edit products','Add, swap or update quantities'],['↻','Change frequency','Choose your delivery interval'],['▣','Change next order','Select another billing date'],['⊗','Skip next order','Skip one upcoming delivery'],['Ⅱ','Pause subscription','Take a break from deliveries'],['⊗','Cancel subscription','Stop future subscription orders']]){
  const b=el('button',label.startsWith('Cancel')?'ftr-sub__danger':'');b.type='button';b.setAttribute('aria-label',label);b.disabled=!mutationAccess;
  add(b,el('span','ftr-sub__manage-icon',icon),el('strong','',label),el('small','',description));b.addEventListener('click',()=>confirmAction(label));add(mg,b);
 }
 add(manage,mg);add(main,manage);
}
fetch(endpoint,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.message||'Unable to load subscription');show(body)}).catch(err=>{main.replaceChildren();const box=card('Unable to load your subscription');add(box,el('p','ftr-sub__error',err.message));add(main,link('Back to account',root.dataset.accountUrl||'/account'),box);});
})();
