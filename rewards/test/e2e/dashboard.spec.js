import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {actionCases,baseSubscription} from '../support/loop-fixture.js';
import {resolveSubscriptionThemeAssets} from '../support/subscription-theme-assets.js';
const assets=resolveSubscriptionThemeAssets();
const labels={skip:'Skip next order',reschedule:'Reschedule',delay:'Delay','order-now':'Order now',frequency:'Change frequency',pause:'Pause subscription',cancel:'Cancel subscription','edit-products':'Edit products','edit-address':'Edit address',discount:'Discount code','order-note':'Order notes'};
const fields={date:'Choose a new date',days:'Delay delivery by',intervalCount:'Every',interval:'Period',preponeFutureOrder:'Place an immediate order',confirmCancellation:'Confirm cancellation',confirmPause:'Confirm pause',lineId:'Product',quantity:'Quantity',value:null,firstName:'First name',lastName:'Last name',address1:'Address',city:'City',countryCode:'Country code',provinceCode:'State code',zip:'Postal code'};

async function setup(page,{unknown=false,rejected=false,subscriptions,mutationsEnabled=true,recommendations="",orderError=false,omitCapabilities=false}={}) {
 const calls=[];let orderReads=0;
 await page.route('http://localhost:4124/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/dashboard.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:await readFile(assets.js,'utf8')});
  if(path==='/dashboard.css')return route.fulfill({contentType:'text/css; charset=utf-8',body:await readFile(assets.css,'utf8')});
  if(path==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<link rel="stylesheet" href="/dashboard.css"><header class="shopify-section-group-header-group">Existing store header</header><section class="ftr-sub" data-account-url="/account" data-shop-url="/collections/all" id="ftr-subscription-dashboard-test" data-endpoint="/apps/ftr-welcome/subscriptions"><main class="ftr-sub__main"><div class="ftr-sub__loading"></div></main><template data-subscription-recommendations>'+recommendations+'</template></section><footer class="shopify-section-group-footer-group">Existing store footer</footer><script src="/dashboard.js"></script>'});
  const body=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(body)calls.push({path,body});
  if(path.endsWith('order-list')){orderReads++;if(orderError&&orderReads===1)return route.fulfill({status:503,json:{ok:false,code:'SUBSCRIPTION_SERVICE_UNAVAILABLE'}});return route.fulfill({json:{ok:true,subscriptionId:body.subscriptionId,kind:body.kind,orders:[{id:'21',status:body.kind==='schedule'?'UNPROCESSED':'PROCESSED',billingDate:'2027-01-14T10:00:00Z',shopifyOrderNumber:'1001'}]}});}
  if(path.endsWith('action-preview'))return route.fulfill({json:{ok:true,preview:true,previewToken:'fixture-preview',message:'Review and confirm.'}});
  if(path.endsWith('action-execute'))return route.fulfill({status:unknown?202:200,json:unknown?{ok:false,applied:false,code:'ACTION_OUTCOME_UNKNOWN',message:'Outcome unknown. Check status.'}:rejected?{ok:false,applied:false,code:'LOOP_REJECTED',operationState:'rejected',retrySafe:true}:{ok:true,applied:true,verified:true}});
  if(path.endsWith('action-status'))return route.fulfill({status:202,json:rejected?{ok:false,applied:false,code:'LOOP_REJECTED',operationState:'rejected',retrySafe:true}:{ok:false,applied:false,code:'ACTION_OUTCOME_UNKNOWN',message:'Still pending. Check status.'}});
  const owned=(subscriptions??[baseSubscription()]).map(s=>omitCapabilities?s:{mutationAllowed:true,...s});
  return route.fulfill({json:{ok:true,...(omitCapabilities?{}:{mutationsEnabled}),subscriptions:owned}});
 });
 await page.goto('http://localhost:4124/');await expect(page.getByRole('heading',{name:/Your subscription is/})).toBeVisible();return calls;
}
for(const [action,payload] of actionCases)test(`${action}: form -> preview -> explicit confirmation -> refresh`,async({page})=>{
 const calls=await setup(page);
 await page.getByRole('button',{name:labels[action],exact:true}).first().click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 for(const [key,value] of Object.entries(payload)){
  const label=key==='value'?(action==='discount'?'Discount code':'Order note'):fields[key];
  const input=dialog.getByLabel(label,{exact:true});
  if(typeof value==='boolean')await input.check();
  else if(['lineId','days','interval','intervalCount'].includes(key))await input.selectOption(String(value));
  else await input.fill(String(value));
 }
 await dialog.getByRole('button',{name:'Review change',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Confirm change',exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(0);
 await dialog.getByRole('button',{name:'Confirm change',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 const preview=calls.find(c=>c.path.endsWith('action-preview')).body;
 const execute=calls.find(c=>c.path.endsWith('action-execute')).body;
 expect(execute.payload).toEqual(preview.payload);expect(execute.requestKey).toBe(preview.requestKey);
 expect(execute.confirm).toBe(true);expect(execute.previewToken).toBe('fixture-preview');
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(1);
});
test('editing an input invalidates the preview',async({page})=>{
 const calls=await setup(page);await page.getByRole('button',{name:'Order notes',exact:true}).click();const d=page.getByRole('dialog');
 await d.getByLabel('Order note',{exact:true}).fill('one');await d.getByRole('button',{name:'Review change'}).click();
 await expect(d.getByRole('button',{name:'Confirm change'})).toBeVisible();
 await d.getByLabel('Order note',{exact:true}).fill('two');await expect(d.getByRole('button',{name:'Confirm change'})).toBeHidden();
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(0);
});
test('unknown result persists through reload and never offers a second write',async({page})=>{
 const calls=await setup(page,{unknown:true});await page.getByRole('button',{name:'Skip next order',exact:true}).click();const d=page.getByRole('dialog');
 await d.getByRole('button',{name:'Review change'}).click();await d.getByRole('button',{name:'Confirm change'}).click();
 await expect(d.getByRole('button',{name:'Check status'})).toBeVisible();
 await d.getByRole('button',{name:'Check status'}).click();await page.reload();
 await expect(page.getByText(/previous change is awaiting verification/i)).toBeVisible();
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(1);
});
test('gift shows a precise blocked state and sends no mutation',async({page})=>{
 const calls=await setup(page);await page.getByRole('button',{name:'Gift',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Loop has not published');expect(calls).toHaveLength(0);
});
test('escape closes dialog and returns focus to trigger',async({page})=>{
 await setup(page);const trigger=page.getByRole('button',{name:'Delay',exact:true});await trigger.click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
});
test('product retry preserves operation-specific fields after a rejection',async({page})=>{
 const calls=await setup(page,{rejected:true});await page.getByRole('button',{name:'Edit products',exact:true}).click();const d=page.getByRole('dialog');
 await d.getByLabel('Quantity',{exact:true}).fill('2');
 for(let i=0;i<2;i++){
  await d.getByRole('button',{name:'Review change'}).click();await d.getByRole('button',{name:'Confirm change'}).click();await expect(d.getByRole('button',{name:'Review change'})).toBeVisible();
 }
 const bodies=calls.filter(c=>c.path.endsWith('action-execute')).map(c=>c.body.payload);
 expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);expect(bodies[1]).not.toHaveProperty('variantShopifyId');
});
test('polling a terminal rejection releases pending state for a fresh review',async({page})=>{
 await setup(page,{unknown:true,rejected:true});await page.getByRole('button',{name:'Skip next order',exact:true}).click();const d=page.getByRole('dialog');
 await d.getByRole('button',{name:'Review change'}).click();await d.getByRole('button',{name:'Confirm change'}).click();await d.getByRole('button',{name:'Check status'}).click();await expect(d.getByRole('button',{name:'Review change'})).toBeVisible();
});

test('all owned subscriptions are selectable and actions stay on the selected subscription after refresh',async({page})=>{
 const other={...baseSubscription(),id:42347175,lineItems:[{id:8,quantity:3,productTitle:'Other customer-owned plan'}]};
 const target={...baseSubscription(),lineItems:[{id:7,quantity:1,productTitle:'Authorized plan'}]};
 const paused={...baseSubscription(),id:42347176,status:'PAUSED',lineItems:[]};
 const calls=await setup(page,{subscriptions:[other,target,paused]});
 const choose=id=>page.getByRole('button',{name:`View subscription #${id}`,exact:true});
 await expect(choose('42347175')).toBeVisible({timeout:1500});await expect(page.locator('[data-subscription-selector]')).toHaveCount(3);
 await expect(choose('42347175')).toHaveAttribute('aria-pressed','true');
 await choose('42347174').click();
 await expect(page.getByTestId('selected-subscription-id')).toHaveText('Subscription #42347174');
 await expect(page.locator('.ftr-sub__products')).toContainText('Authorized plan');
 await expect(page.locator('.ftr-sub__products')).not.toContainText('Other customer-owned plan');
 await page.getByRole('button',{name:'Order notes',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Order note',{exact:true}).fill('Target plan note');
 await dialog.getByRole('button',{name:'Review change',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm change',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(calls.filter(c=>/action-(preview|execute)$/.test(c.path)).map(c=>c.body.subscriptionId)).toEqual(['42347174','42347174']);
 await expect(choose('42347174')).toHaveAttribute('aria-pressed','true');
 await choose('42347176').click();await expect(page.getByRole('heading',{name:/Your subscription is paused/})).toBeVisible();
});
test('pending outcomes remain isolated when switching subscriptions',async({page})=>{
 const calls=await setup(page,{unknown:true,subscriptions:[baseSubscription(),{...baseSubscription(),id:42347175}]});
 const choose=id=>page.getByRole('button',{name:`View subscription #${id}`,exact:true});await expect(choose('42347174')).toBeVisible({timeout:1500});
 await page.getByRole('button',{name:'Skip next order',exact:true}).click();let dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Review change'}).click();await dialog.getByRole('button',{name:'Confirm change'}).click();
 await expect(dialog.getByRole('button',{name:'Check status'})).toBeVisible();await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await choose('42347175').click();await expect(page.getByText(/previous change is awaiting verification/i)).toHaveCount(0);
 await page.getByRole('button',{name:'Order notes',exact:true}).click();dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('button',{name:'Check status'})).toBeHidden();await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await choose('42347174').click();await page.getByRole('button',{name:'Skip next order',exact:true}).click();dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('button',{name:'Review change'})).toBeHidden();await dialog.getByRole('button',{name:'Check status'}).click();
 const execute=calls.find(c=>c.path.endsWith('action-execute')).body,status=calls.find(c=>c.path.endsWith('action-status')).body;
 expect(status.subscriptionId).toBe('42347174');expect(status.requestKey).toBe(execute.requestKey);
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(1);
});
test('single subscription shows its identity without an unnecessary selector',async({page})=>{
 await setup(page);await expect(page.getByTestId('selected-subscription-id')).toHaveText('Subscription #42347174',{timeout:1500});
 await expect(page.getByRole('combobox',{name:'Choose subscription',exact:true})).toHaveCount(0);
});
test('a refreshed empty customer response clears the previous subscription details',async({page})=>{
 const subscriptions=[baseSubscription()];await setup(page,{subscriptions});subscriptions.length=0;await page.reload();
 await expect(page.getByRole('heading',{name:'No subscriptions found'})).toBeVisible();
 await expect(page.getByTestId('selected-subscription-id')).toHaveCount(0);await expect(page.getByRole('button',{name:'Order notes',exact:true})).toHaveCount(0);
});

test('account link, saved note, active discounts and real recommendation links replace placeholders',async({page})=>{
 const sub={...baseSubscription(),orderNote:'Use the side entrance',discounts:[{title:'Member offer',isActive:true},{title:'Expired offer',isActive:false}]};
 await setup(page,{subscriptions:[sub],recommendations:'<article class="ftr-sub__rec" data-product-id="11"><a href="/products/aloe-mist">Aloe mist</a></article>'});
 await expect(page.getByRole('link',{name:'Back to account',exact:true})).toHaveAttribute('href','/account');
 await expect(page.getByTestId('subscription-note')).toHaveText('Use the side entrance');
 await expect(page.getByTestId('subscription-discounts')).toContainText('Member offer');await expect(page.getByTestId('subscription-discounts')).not.toContainText('Expired offer');
 await expect(page.getByRole('link',{name:'Aloe mist',exact:true})).toHaveAttribute('href','/products/aloe-mist');
 await expect(page.getByText(/Recommendations will appear/)).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Manage payment methods in account',exact:true})).toHaveAttribute('href','/account');
});
test('order schedule and history load only for the selected subscription and can retry failures',async({page})=>{
 const calls=await setup(page,{orderError:true,subscriptions:[baseSubscription(),{...baseSubscription(),id:42347175}]});
 await page.getByRole('button',{name:'View subscription #42347175',exact:true}).click();
 await page.getByText('Scheduled orders',{exact:true}).click();
 const schedule=page.getByTestId('subscription-schedule');await expect(schedule).toContainText('Unable to load orders');
 await schedule.getByRole('button',{name:'Try again'}).click();await expect(schedule).toContainText('UNPROCESSED');
 await page.getByText('Past orders',{exact:true}).click();await expect(page.getByTestId('subscription-history')).toContainText('PROCESSED');
 expect(calls.filter(c=>c.path.endsWith('order-list')).map(c=>c.body.subscriptionId)).toEqual(['42347175','42347175','42347175']);
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(0);
});
test('read-only deployment explains unavailable changes and never offers an executable action',async({page})=>{
 const calls=await setup(page,{mutationsEnabled:false});
 await expect(page.getByText('Subscription changes are currently disabled. You can still view your details and orders.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Order now',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Edit products',exact:true})).toBeDisabled();
 await expect(page.getByText(/Gift orders are unavailable/)).toBeVisible();
 expect(calls).toHaveLength(0);
});
test('mobile subscription cards fit the viewport and return to the account portal',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{subscriptions:[baseSubscription(),{...baseSubscription(),id:42347175}]});
 await expect(page.getByRole('button',{name:'View subscription #42347175',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'View subscription #42347175',exact:true}).click();await expect(page.getByTestId('selected-subscription-id')).toHaveText('Subscription #42347175');
 await expect(page.getByRole('link',{name:'Back to account',exact:true})).toBeVisible();
});

test('read-only mode still permits checking an existing pending request without another write',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('ftr-subscription-pending:42347174',JSON.stringify({subscriptionId:'42347174',requestKey:'existing-pending-request-1234',action:'skip'})));
 const calls=await setup(page,{mutationsEnabled:false});
 await page.getByRole('button',{name:'Check pending change',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Check status',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Review change',exact:true})).toBeHidden();
 expect(calls.filter(c=>c.path.endsWith('action-status'))).toHaveLength(1);expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(0);
});

test('missing capability fields keep the dashboard read-only',async({page})=>{
 const calls=await setup(page,{omitCapabilities:true});
 await expect(page.getByText('Subscription changes are currently disabled. You can still view your details and orders.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Skip next order',exact:true})).toBeDisabled();expect(calls).toHaveLength(0);
});

for(const [name,options] of [
 ['null store capability',{mutationsEnabled:null}],
 ['null subscription capability',{subscriptions:[{...baseSubscription(),mutationAllowed:null}]}],
 ['string store capability',{mutationsEnabled:'true'}],
 ['string subscription capability',{subscriptions:[{...baseSubscription(),mutationAllowed:'true'}]}]
])test(name+' cannot grant mutation access',async({page})=>{
 const calls=await setup(page,options);await expect(page.getByRole('button',{name:'Skip next order',exact:true})).toBeDisabled();expect(calls).toHaveLength(0);
});

test('routine Add reviews a one-time variant and quantity without a product-page redirect',async({page})=>{
 const calls=await setup(page,{recommendations:'<article class="ftr-sub__rec" data-product-id="11" data-variants="[{&quot;id&quot;:&quot;101&quot;,&quot;title&quot;:&quot;Mist / Small&quot;},{&quot;id&quot;:&quot;102&quot;,&quot;title&quot;:&quot;Mist / Large&quot;}]"><h3>Aloe mist</h3><button type="button" data-add-once>Add</button></article>'});
 await page.getByRole('button',{name:'Add Aloe mist once',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d).toContainText('next order only');await d.getByLabel('New product',{exact:true}).selectOption('102');await d.getByLabel('Quantity',{exact:true}).fill('2');
 await d.getByRole('button',{name:'Review change'}).click();expect(calls.find(c=>c.path.endsWith('action-preview')).body.payload).toEqual({operation:'add-once',variantShopifyId:'102',quantity:2});
 expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(0);await d.getByRole('button',{name:'Confirm change'}).click();expect(calls.filter(c=>c.path.endsWith('action-execute'))).toHaveLength(1);
});

test('one-time dialog keyboard cycles through visible controls only',async({page})=>{
 await setup(page,{recommendations:'<article class="ftr-sub__rec" data-variants="[{&quot;id&quot;:&quot;202&quot;,&quot;title&quot;:&quot;Mist&quot;}]"><h3>Mist</h3><button type="button" data-add-once>Add</button></article>'});
 await page.getByRole('button',{name:'Add Mist once'}).click();const d=page.getByRole('dialog');
 await d.getByRole('button',{name:'Review change'}).focus();await page.keyboard.press('Tab');await expect(d.getByLabel('New product',{exact:true})).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(d.getByRole('button',{name:'Review change'})).toBeFocused();
});

test('read-only routine add stays disabled and existing one-time lines are clearly labelled',async({page})=>{
 const sub=baseSubscription();sub.lineItems.push({id:8,variantShopifyId:202,quantity:1,isOneTimeAdded:true});
 const calls=await setup(page,{mutationsEnabled:false,subscriptions:[sub],recommendations:'<article class="ftr-sub__rec" data-variants="[{&quot;id&quot;:&quot;303&quot;,&quot;title&quot;:&quot;Mist&quot;}]"><h3>Mist</h3><button type="button" data-add-once>Add</button></article>'});
 await expect(page.getByRole('button',{name:'Add Mist once'})).toBeDisabled();await expect(page.getByText('One-time · Next order only',{exact:true})).toBeVisible();expect(calls).toHaveLength(0);
});

for(const width of [390,1280])test(`existing store header and footer remain visible at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await setup(page);
 await expect(page.getByText('Existing store header',{exact:true})).toBeVisible();await expect(page.getByText('Existing store footer',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Back to account',exact:true})).toHaveAttribute('href','/account');
});
