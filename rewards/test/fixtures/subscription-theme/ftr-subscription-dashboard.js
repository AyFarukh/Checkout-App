(()=>{'use strict';const root=document.querySelector('[id^="ftr-subscription-dashboard-"]');if(!root||!root.querySelector('.ftr-sub__loading'))return;const main=root.querySelector('.ftr-sub__main'),endpoint=root.dataset.endpoint;const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n};const add=(parent,...children)=>{for(const child of children)if(child)parent.append(child);return parent};const pick=(o,...keys)=>keys.map(k=>o?.[k]).find(v=>v!==undefined&&v!==null&&v!=='');const number=v=>{if(v==null||v==='')return null;if(typeof v==='object')return number(pick(v,'amount','value','price','total'));const n=Number(String(v).replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:null};const money=(v,c)=>v==null?'Price unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(v);const date=v=>{if(v===null||v===undefined||v==='')return'Not scheduled';const raw=String(v);const d=(typeof v==='number'||/^\d{10,13}$/.test(raw))?new Date(Number(v)*(Number(v)<1e12?1000:1)):new Date(v);return Number.isNaN(d.getTime())?'Not scheduled':d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})};const img=v=>typeof v==='string'?v:pick(v,'url','src','originalSrc')||'';const lines=s=>[s.lines,s.lineItems,s.subscriptionLines,s.items,s.products,s.subscriptionProducts].find(Array.isArray)||[];const card=(title,id)=>{const n=el('section','ftr-sub__card');if(id)n.id=id;if(title){const h=el('h2','',title),name=({'Your subscription':'box','Payment details':'card','Shipping address':'truck'})[title];if(name)h.prepend(icon(name));add(n,h);}return n};const btn=(label,primary=false,action=label)=>{const b=el('button','ftr-sub__btn'+(primary?' ftr-sub__btn--primary':''),label);b.type='button';const symbol=({'Order now':'cart','Gift':'gift','Skip':'skip','Skip next order':'skip','Reschedule':'calendar','Delay':'clock'})[label];if(symbol)b.prepend(icon(symbol));if(mutationAccess===false&&actionMap[action]&&actionMap[action]!=='gift'){b.disabled=true;b.title='Subscription changes are currently disabled.';}if(actionMap[action]==='gift'){b.disabled=true;b.title='Gift is currently unavailable.';return b;}b.addEventListener('click',()=>confirmAction(action));return b};let selectedSubscription=null,mutationAccess=false;
const actionMap={"Add one-time product":"edit-products","Manage next order":"reschedule","Order now":"order-now","Skip":"skip","Skip next order":"skip","Reschedule":"reschedule","Change next order":"reschedule","Delay":"delay","Change frequency":"frequency","Pause subscription":"pause","Cancel subscription":"cancel","Edit products":"edit-products","Edit subscription":"edit-products","Edit address":"edit-address","Gift":"gift","Order notes":"order-note","Discount code":"discount"};
const pendingStorageKey=()=>`ftr-subscription-pending:${selectedSubscription?.id}`;
let pending=null;
function pendingRead(){try{return JSON.parse(localStorage.getItem(pendingStorageKey())||'null')}catch{return null}}
function pendingWrite(value){try{if(value)localStorage.setItem(pendingStorageKey(),JSON.stringify(value));else localStorage.removeItem(pendingStorageKey());pending=value;return true}catch{return false}}
async function actionRequest(path,body){
 const response=await fetch(endpoint+'/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 if(!(response.headers.get('content-type')||'').includes('application/json'))throw Error('Unexpected subscription service response. Check the status before submitting again.');
 const result=await response.json();return {response,result};
}
function confirmAction(label,oneTimeProduct){
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
 if(action==='edit-products'&&oneTimeProduct){
  const operation=field('operation','Purchase type','hidden',undefined,'add-once');operation.parentElement.hidden=true;
  field('variantShopifyId','New product','select',oneTimeProduct.variants.map(v=>[v.id,v.title]),oneTimeProduct.variants[0].id);
  const quantity=field('quantity','Quantity','number',undefined,1);quantity.min='1';quantity.max='99';quantity.step='1';
 }
 if(action==='edit-products'&&!oneTimeProduct){
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
 const note=el('p','ftr-sub__muted',action==='order-now'?'This places an order immediately and may charge your saved payment method.':action==='cancel'?'Cancellation stops future orders. Review carefully before confirming.':action==='pause'?'Pause until you resume through Loop.':oneTimeProduct?'Add this product to your next order only. It will not repeat in future orders. Loop sets the product price.':action==='edit-products'?'Add, swap, remove a product or change its quantity. Loop sets the selling plan price. Bundles require Loop’s editor.':'Review your details. Changes are only available for the authorized test subscription.');
 add(actions,cancel,review,confirm,check);add(form,status);add(panel,el('h2','',label),note,form,actions);add(backdrop,panel);add(document.body,backdrop);
 function keys(e){
  if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){
   const focusable=[...panel.querySelectorAll('input,select,textarea,button')].filter(n=>!n.hidden&&!n.disabled&&n.type!=='hidden'&&!n.closest('[hidden]')&&n.getClientRects().length>0),first=focusable[0],last=focusable.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }
 document.addEventListener('keydown',keys);backdrop.addEventListener('click',e=>{if(e.target===backdrop)close();});cancel.focus();
 const lock=()=>{review.hidden=true;confirm.hidden=true;check.hidden=false;for(const input of Object.values(inputs))input.disabled=true;};
 const resultMessage=result=>{status.textContent=result.message||result.code||'The change could not be verified.';};
 function rejected(result){
  pendingWrite(null);requestKey=crypto.randomUUID();
  for(const input of Object.values(inputs))input.disabled=false;
  if(action==='edit-products'&&!oneTimeProduct){
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
 else if(action==='gift'){review.hidden=true;status.textContent='Gift is currently unavailable in this dashboard.';}
 else if(!mutationAccess){review.hidden=true;status.textContent='Subscription changes are currently disabled.';}
 else if(!action){review.hidden=true;status.textContent='Manage this option through your Shopify account or the Loop customer portal.';}
}

function btnClose(t,fn){const b=el('button','ftr-sub__btn ftr-sub__btn--primary',t);b.type='button';b.addEventListener('click',fn);return b}
function icon(name){
 const paths={home:['M3 11 12 3l9 8','M5 10v11h5v-7h4v7h5V10'],refresh:['M3 10a9 9 0 0 1 15.4-6.4L21 6','M21 2v4h-4','M21 14a9 9 0 0 1-15.4 6.4L3 18','M3 22v-4h4'],cart:['M3 3h2l3 12h11l2-9H6','M9 20h.01M18 20h.01'],gift:['M3 8h18v4H3z','M5 12v9h14v-9','M12 8v13','M12 8H8a3 3 0 1 1 3-4l1 4Zm0 0h4a3 3 0 1 0-3-4l-1 4Z'],skip:['m4 5 4 4 8 10h4','m17 16 3 3-3 3','M4 19h4l8-14h4','m17 2 3 3-3 3'],calendar:['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z','M8 2v4M16 2v4M3 10h18','M9 14h.01M15 14h.01M9 18h.01'],schedule:['M8 4V2M16 4V2','M6 4h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z','M16 13a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z','M12 10v3l2 1'],clock:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 7v5l3 2'],box:['m3 7 9-5 9 5v10l-9 5-9-5Z','m3 7 9 5 9-5M12 12v10M7 4.8l9 5'],note:['M5 3h14v18H5z','m8 15 7-7 2 2-7 7H8Z'],tag:['M9 3H5a2 2 0 0 0-2 2v4a3 3 0 0 1 0 6v4a2 2 0 0 0 2 2h4','M15 3h4a2 2 0 0 1 2 2v4a3 3 0 0 0 0 6v4a2 2 0 0 1-2 2h-4','M12 3v3M12 18v3','m9 15 6-6M9 9h.01M15 15h.01'],card:['M3 5h18v14H3z','M3 9h18M7 15h3'],truck:['M2 5h12v12H2z','M14 10h4l4 4v3h-8','M7 19a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM21 19a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z'],pin:['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z','M15 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z'],check:['M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z','m8 12 3 3 5-6'],pause:['M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z','M9 8v8M15 8v8'],cancel:['M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z','m9 9 6 6M15 9l-6 6'],edit:['m14 5 5-3 3 5-3 3-4-1-9 12a2 2 0 0 1-3-3l11-10Z','m3 3 3-1 4 5-2 2-5-4Z','m14 14 6 6a2 2 0 0 1-3 2l-5-6'],arrow:['M4 12h16','m15 7 5 5-5 5'],chevron:['m9 5 7 7-7 7'],help:['M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z','M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01'],user:['M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z','M15 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z','M6 19v-2c0-4 12-4 12 0v2'],phone:['M7 3 3 5c0 8 8 16 16 16l2-4-5-3-2 2-6-6 2-2Z']};
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ftr-sub__icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 for(const d of paths[name]||paths.box){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}return svg;
}
function paymentAccountLink(href){const a=link('Update payment method',href,true);a.setAttribute('aria-label','Manage payment methods in account');return a;}
function detailRow(label,value,action,iconName,testId){
 const row=el('div','ftr-sub__detail-row'),title=el('span','ftr-sub__row-label'),text=el('span','ftr-sub__row-value',value);if(testId)text.dataset.testid=testId;
 add(title,icon(iconName),el('span','',label));const edit=btn('Edit',false,action);edit.setAttribute('aria-label',action);add(edit,icon('chevron'));add(row,title,text,edit);return row;
}

function link(label,href,primary=false){const a=el('a','ftr-sub__btn'+(primary?' ftr-sub__btn--primary':''),label);a.href=href;return a;}
function orderView(subscriptionId,kind){
 const details=el('details','ftr-sub__order-view'),summary=el('summary','',kind==='schedule'?'Scheduled orders':'Past orders'),body=el('div','ftr-sub__order-body');
 body.setAttribute('data-testid','subscription-'+kind);summary.prepend(icon(kind==='schedule'?'schedule':'calendar'));summary.append(icon('chevron'));add(details,summary,body);let loaded=false,loading=false;
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
function identityPlaceholder(id){const n=el('div');n.id='ftr-subscription-list';return n;}
function show(data,preferredId=selectedSubscription?.id){
 const subscriptions=(Array.isArray(data.subscriptions)?data.subscriptions:[]).filter(s=>s&&s.id!=null).slice().sort((a,b)=>(String(b.status).toUpperCase()==='ACTIVE')-(String(a.status).toUpperCase()==='ACTIVE'));
 const s=subscriptions.find(item=>String(item.id)===String(preferredId))||subscriptions[0];
 main.replaceChildren();selectedSubscription=s||null;pending=null;
 const accountUrl=root.dataset.accountUrl||'/account';
 for(const node of root.querySelectorAll('[data-icon]'))if(!node.querySelector('svg'))node.prepend(icon(node.dataset.icon));
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
 add(chooser,choices);if(subscriptions.length>1)add(main,chooser);else add(main,identityPlaceholder(s.id));
 const identity=el('p','ftr-sub__subscription-id',`Subscription #${s.id}`);identity.setAttribute('data-testid','selected-subscription-id');
 const intro=el('header','ftr-sub__intro');add(intro,identity,el('h1','','Your subscription is '+String(s.status||'unknown').toLowerCase()),el('p','','Manage your products, schedule and delivery details.'));intro.querySelector('h1').append(icon(String(s.status).toUpperCase()==='ACTIVE'?'check':'pause'));add(main,intro);
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
 const timing=el('div','ftr-sub__next-info'),calendar=el('span','ftr-sub__calendar'),timingText=el('div');add(calendar,icon('calendar'));add(timingText,el('div','ftr-sub__next-date',date(next)),el('p','ftr-sub__next-total',money(total,currency)));add(timing,calendar,timingText);add(info,timing);
 const ul=el('ul','ftr-sub__products');for(const item of items)add(ul,el('li','',(pick(item,'productTitle','title','name')||'Subscription product')+' × '+(item.quantity||1)));add(info,ul);
 const hero=el('div','ftr-sub__hero'),first=items.map(l=>img(pick(l,'imageUrl','image','productImage','variantImage'))).find(Boolean);
 if(first){const image=el('img');image.src=first;image.alt='Subscription products';image.loading='lazy';add(hero,image);}else add(hero,el('span','ftr-sub__muted','Your subscription products'));
 add(grid,info,hero);add(nextCard,grid);const actions=el('div','ftr-sub__actions');
 for(const [label,primary]of [['Manage next order',true],['Order now'],['Gift'],['Skip'],['Reschedule'],['Delay']])add(actions,btn(label,primary));
 let chargeNotice;const lastCharge=pick(s,'lastOrderDate','lastBillingDate','lastChargedAt');if(lastCharge){const notice=el('p','ftr-sub__notice','Your last order was charged on '+date(lastCharge)+'.');notice.prepend(icon('clock'));chargeNotice=notice;}
 add(nextCard,actions,chargeNotice,el('p','ftr-sub__muted','Gift orders are unavailable in this custom dashboard because Loop does not provide a gift-order API.'));add(main,nextCard);
 const columns=el('div','ftr-sub__columns'),sub=card('Your subscription','ftr-subscription');
 for(const item of items){
  const row=el('div','ftr-sub__product'),imageUrl=img(pick(item,'imageUrl','image','productImage','variantImage'));
  if(imageUrl){const image=el('img');image.src=imageUrl;image.loading='lazy';image.alt='';add(row,image);}else add(row,el('div','ftr-sub__product-placeholder'));
  const detail=el('div');add(detail,el('h3','',pick(item,'productTitle','title','name')||'Subscription product'),el('p','',money(lp(item),currency)+' · Quantity '+(item.quantity||1)));if(item.isOneTimeAdded===true)add(detail,el('p','ftr-sub__badge','One-time · Next order only'));add(row,detail);add(sub,row);
 }
 add(sub,el('p','ftr-sub__muted','Delivery every '+(freq.intervalCount||freq.interval_count||1)+' '+String(freq.interval||'month').toLowerCase()),btn('Edit subscription'));
 const note=Object.prototype.hasOwnProperty.call(s,'orderNote')?s.orderNote:s.note;
 const discounts=(s.discounts||[]).map(d=>d?.node||d).filter(d=>d&&d.isActive!==false&&!d.rejectionReason).map(d=>pick(d,'title','code','discountCode')||'Subscription discount').join(', ');
 add(sub,detailRow('Order notes',note||'Add your note.','Order notes','note','subscription-note'),detailRow('Discount code',discounts||'No active discounts.','Discount code','tag','subscription-discounts'),detailRow('Subscription plan','Deliver every '+(freq.intervalCount||1)+' '+String(freq.interval||'month').toLowerCase(),'Change frequency','calendar'));
 const orders=el('div','ftr-sub__orders');orders.id='ftr-orders';add(orders,orderView(s.id,'schedule'),orderView(s.id,'history'),link('View all orders in account',accountUrl));add(sub,orders);
 const side=el('div','ftr-sub__stack'),shipping=card('Shipping address','ftr-address');
 const fullName=[address.firstName,address.lastName].filter(Boolean).join(' '),city=[address.city,address.province||address.provinceCode,address.zip].filter(Boolean).join(', ');
 add(shipping,el('p','ftr-sub__address',[fullName,address.company,address.address1,address.address2,city,address.country||address.countryCode].filter(Boolean).join('\n')||'No shipping address available.'),btn('Edit address'));
 const payment=card('Payment details','ftr-payment');payment.classList.add('ftr-sub__payment');add(payment,el('p','ftr-sub__muted','Manage saved payment methods securely in your account portal.'),paymentAccountLink(accountUrl));
 add(payment,link('Add a backup payment method',accountUrl));add(side,payment,shipping);add(columns,sub,side);add(main,columns);

 const template=root.querySelector('[data-subscription-recommendations]');
 if(template?.content?.children.length){
  const recommended=template.content.cloneNode(true),existing=new Set(items.map(l=>String(l.variantShopifyId||l.variantId||l.shopifyVariantId||'')));
  for(const product of recommended.querySelectorAll('[data-variant-ids]')){try{if(JSON.parse(product.dataset.variantIds).some(id=>existing.has(String(id))))product.remove();}catch{product.remove();}}
  for(const tile of [...recommended.children].slice(5))tile.remove();
  for(const product of recommended.querySelectorAll('[data-add-once]')){const tile=product.closest('[data-variants]');let variants=[];try{variants=JSON.parse(tile.dataset.variants).filter(v=>/^\d+$/.test(String(v.id)));}catch{}if(!variants.length){product.disabled=true;continue;}const title=tile.querySelector('h3')?.textContent||'Product';product.setAttribute('aria-label','Add '+title+' once');product.disabled=!mutationAccess;product.addEventListener('click',()=>confirmAction('Add one-time product',{variants}));}
  if(recommended.children.length){const rec=card('Complete your routine'),products=el('div','ftr-sub__recommend');add(products,recommended);add(rec,el('p','ftr-sub__muted','Goes well with your next order. Add once, without changing future orders.'),link('See more products',root.dataset.shopUrl||'/collections/all'),products);add(main,rec);}
 }
 const manage=card('Manage your subscription');add(manage,el('p','ftr-sub__muted','Need to make a change? You are in control.'));const mg=el('div','ftr-sub__manage');
 for(const [symbol,label,description]of [['edit','Edit products','Change what you receive'],['refresh','Change frequency','Choose how often'],['calendar','Change next order','Pick another date'],['cancel','Skip next order','Skip without cancelling'],['pause','Pause subscription','Take a temporary break'],['cancel','Cancel subscription','End your subscription']]){
  const b=el('button',label.startsWith('Cancel')?'ftr-sub__danger':'');b.type='button';b.setAttribute('aria-label',label);b.disabled=!mutationAccess;
  const symbolWrap=el('span','ftr-sub__manage-icon');add(symbolWrap,icon(symbol));add(b,symbolWrap,el('strong','',label),el('small','',description));b.addEventListener('click',()=>confirmAction(label));add(mg,b);
 }
 add(manage,mg);add(main,manage);
}
fetch(endpoint,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.message||'Unable to load subscription');show(body)}).catch(err=>{main.replaceChildren();const box=card('Unable to load your subscription');add(box,el('p','ftr-sub__error',err.message));add(main,link('Back to account',root.dataset.accountUrl||'/account'),box);});
})();
