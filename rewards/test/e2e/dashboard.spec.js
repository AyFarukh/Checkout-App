import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {actionCases,baseSubscription} from '../support/loop-fixture.js';
const asset=new URL('../../../../theme/assets/ftr-subscription-dashboard.js',import.meta.url);
const labels={skip:'Skip next order',reschedule:'Reschedule',delay:'Delay','order-now':'Order now',frequency:'Change frequency',pause:'Pause subscription',cancel:'Cancel subscription','edit-products':'Edit products','edit-address':'Edit address',discount:'Discount code','order-note':'Order notes'};
const fields={date:'Choose a new date',days:'Delay delivery by',intervalCount:'Every',interval:'Period',preponeFutureOrder:'Place an immediate order',confirmCancellation:'Confirm cancellation',confirmPause:'Confirm pause',lineId:'Product',quantity:'Quantity',value:null,firstName:'First name',lastName:'Last name',address1:'Address',city:'City',countryCode:'Country code',provinceCode:'State code',zip:'Postal code'};

async function setup(page,{unknown=false,rejected=false}={}) {
 const calls=[];
 await page.route('http://localhost:4124/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/dashboard.js')return route.fulfill({contentType:'text/javascript',body:await readFile(process.env.FTR_THEME_ASSET||asset,'utf8')});
  if(path==='/')return route.fulfill({contentType:'text/html',body:'<section id="ftr-subscription-dashboard-test" data-endpoint="/apps/ftr-welcome/subscriptions"><main class="ftr-sub__main"><div class="ftr-sub__loading"></div></main></section><script src="/dashboard.js"></script>'});
  const body=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(body)calls.push({path,body});
  if(path.endsWith('action-preview'))return route.fulfill({json:{ok:true,preview:true,previewToken:'fixture-preview',message:'Review and confirm.'}});
  if(path.endsWith('action-execute'))return route.fulfill({status:unknown?202:200,json:unknown?{ok:false,applied:false,code:'ACTION_OUTCOME_UNKNOWN',message:'Outcome unknown. Check status.'}:rejected?{ok:false,applied:false,code:'LOOP_REJECTED',operationState:'rejected',retrySafe:true}:{ok:true,applied:true,verified:true}});
  if(path.endsWith('action-status'))return route.fulfill({status:202,json:rejected?{ok:false,applied:false,code:'LOOP_REJECTED',operationState:'rejected',retrySafe:true}:{ok:false,applied:false,code:'ACTION_OUTCOME_UNKNOWN',message:'Still pending. Check status.'}});
  return route.fulfill({json:{ok:true,subscriptions:[baseSubscription()]}});
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
