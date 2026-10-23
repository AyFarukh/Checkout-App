import {test,expect} from './fixtures.js';
import {actionCases} from '../support/loop-fixture.js';
const labels={skip:'Skip next order',reschedule:'Reschedule',delay:'Delay','order-now':'Order now',frequency:'Change frequency',pause:'Pause subscription',cancel:'Cancel subscription','edit-products':'Edit products','edit-address':'Edit address',discount:'Discount code','order-note':'Order notes'};
const names={date:'Choose a new date',days:'Delay delivery by',intervalCount:'Every',interval:'Period',preponeFutureOrder:'Place an immediate order',confirmCancellation:'Confirm cancellation',confirmPause:'Confirm pause',lineId:'Product',quantity:'Quantity',firstName:'First name',lastName:'Last name',address1:'Address',city:'City',countryCode:'Country code',provinceCode:'State code',zip:'Postal code'};
test.beforeEach(async({request})=>{const result=await request.post('http://127.0.0.1:4123/__fixture/reset');expect(result.ok()).toBeTruthy();});
for(const [action,payload] of actionCases)test(`${action}: browser, signed proxy, Mongo, provider and verified result`,async({page,request})=>{
 await page.goto('http://127.0.0.1:4123/');
 await page.getByRole('button',{name:labels[action],exact:true}).first().click();const d=page.getByRole('dialog');
 for(const [key,value] of Object.entries(payload)){
  const name=key==='value'?(action==='discount'?'Discount code':'Order note'):names[key];
  const input=d.getByLabel(name,{exact:true});
  if(typeof value==='boolean')await input.check();else if(['lineId','days','interval','intervalCount'].includes(key))await input.selectOption(String(value));else await input.fill(String(value));
 }
 await d.getByRole('button',{name:'Review change',exact:true}).click();
 await expect(d.getByRole('button',{name:'Confirm change',exact:true})).toBeVisible();
 await d.getByRole('button',{name:'Confirm change',exact:true}).click();await expect(d).toHaveCount(0);
 const state=await (await request.get('http://127.0.0.1:4123/__fixture/state')).json();
 expect(state.writes).toBe(1);expect(state.attempts).toHaveLength(1);expect(state.attempts[0].status).toBe('applied');expect(state.attempts[0].verifiedAt).toBeTruthy();
});
test('gift remains blocked without a provider write',async({page,request})=>{
 await page.goto('http://127.0.0.1:4123/');await page.getByRole('button',{name:'Gift',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Loop has not published');
 expect((await (await request.get('http://127.0.0.1:4123/__fixture/state')).json()).writes).toBe(0);
});
for(const operation of ['add','swap','remove'])test(`product ${operation}: full stack with merchant catalog and controlled pricing`,async({page,request})=>{
 if(operation==='remove')await request.post('http://127.0.0.1:4123/__fixture/reset',{data:{twoLines:true}});
 await page.goto('http://127.0.0.1:4123/');await page.getByRole('button',{name:'Edit products',exact:true}).click();const d=page.getByRole('dialog');
 await d.getByLabel('Product change',{exact:true}).selectOption(operation);
 if(operation!=='remove'){await d.getByLabel('New product',{exact:true}).selectOption('101');await d.getByLabel('Quantity',{exact:true}).fill('2');}
 await d.getByRole('button',{name:'Review change'}).click();await expect(d.getByRole('button',{name:'Confirm change'})).toBeVisible();await d.getByRole('button',{name:'Confirm change'}).click();await expect(d).toHaveCount(0);
 const state=await (await request.get('http://127.0.0.1:4123/__fixture/state')).json();expect(state.writes).toBe(1);expect(state.attempts[0].status).toBe('applied');
});
test('mobile dialog keeps confirmation usable and excludes hidden product fields',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:4123/');await page.getByRole('button',{name:'Edit products',exact:true}).click();const d=page.getByRole('dialog');await expect(d.getByLabel('New product',{exact:true})).toBeHidden();await expect(d.getByRole('button',{name:'Review change'})).toBeVisible();
});
