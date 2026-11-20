import {test,expect} from './fixtures.js';
import {actionCases} from '../support/loop-fixture.js';
const labels={skip:'Skip next order',reschedule:'Reschedule',delay:'Delay','order-now':'Order now',frequency:'Change frequency',pause:'Pause subscription',cancel:'Cancel subscription','edit-products':'Edit products','edit-address':'Edit address',discount:'Discount code','order-note':'Order notes'};
const names={date:'Choose a new date',days:'Delay delivery by',intervalCount:'Every',interval:'Period',preponeFutureOrder:'Place an immediate order',confirmCancellation:'Confirm cancellation',confirmPause:'Confirm pause',lineId:'Product',quantity:'Quantity',firstName:'First name',lastName:'Last name',address1:'Address',city:'City',countryCode:'Country code',provinceCode:'State code',zip:'Postal code'};
test.beforeEach(async({request})=>{const result=await request.post('http://127.0.0.1:4123/__fixture/reset');expect(result.ok()).toBeTruthy();});
for(const mode of ['test','production'])for(const [action,payload] of actionCases)test(`${mode} ${action}: browser, signed proxy, Mongo, provider and verified result`,async({page,request})=>{
 if(mode==='production')await request.post('http://127.0.0.1:4123/__fixture/reset',{data:{production:true}});
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
 await page.goto('http://127.0.0.1:4123/');await expect(page.getByRole('button',{name:'Gift',exact:true})).toBeDisabled();await expect(page.getByRole('dialog')).toHaveCount(0);
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

for(const mode of ['test','production'])test(`${mode} routine one-time Add traverses browser, signed proxy, Mongo, once endpoint and verified refresh`,async({page,request})=>{
 if(mode==='production')await request.post('http://127.0.0.1:4123/__fixture/reset',{data:{production:true}});
 await page.goto('http://127.0.0.1:4123/');await page.getByRole('button',{name:'Add One-time product once',exact:true}).click();const d=page.getByRole('dialog');
 await expect(d).toContainText('next order only');await d.getByRole('button',{name:'Review change'}).click();await expect(d.getByRole('button',{name:'Confirm change'})).toBeVisible();await d.getByRole('button',{name:'Confirm change'}).click();await expect(d).toHaveCount(0);
 const state=await (await request.get('http://127.0.0.1:4123/__fixture/state')).json();expect(state.writes).toBe(1);expect(state.attempts[0].status).toBe('applied');
});

test('journey reward, confirmed order-now and replay traverse signed routes, Mongo and real provider HTTP',async({page,request})=>{
 let submitted;page.on('request',r=>{if(r.url().endsWith('/action-execute'))submitted=r.postDataJSON();});
 await request.post('http://127.0.0.1:4123/__fixture/reset',{data:{}});await request.post('http://127.0.0.1:4123/__fixture/journey');await page.goto('http://127.0.0.1:4123/');
 const journey=page.getByRole('region',{name:'Subscriber journey'});await expect(journey.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');await expect(journey.getByText(/additional 10% discount is confirmed/)).toBeVisible();
 await journey.getByRole('button',{name:'Ship now & unlock perks'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Place an immediate order',{exact:true}).check();await dialog.getByRole('button',{name:'Review change',exact:true}).click();await expect(dialog.getByRole('button',{name:'Confirm change',exact:true})).toBeVisible();let state=await(await request.get('http://127.0.0.1:4123/__fixture/state')).json();expect(state.writes).toBe(1);
 await dialog.getByRole('button',{name:'Confirm change',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(journey.getByRole('progressbar')).toHaveAttribute('aria-valuenow','2');state=await(await request.get('http://127.0.0.1:4123/__fixture/state')).json();expect(state.writes).toBe(2);expect(state.attempts.filter(a=>a.status==='applied')).toHaveLength(2);const replay=await request.post('http://127.0.0.1:4123/apps/ftr-welcome/subscriptions/action-execute',{data:submitted});expect((await replay.json()).replayed).toBe(true);expect((await(await request.get('http://127.0.0.1:4123/__fixture/state')).json()).writes).toBe(2);
});
test('journey skip resets after verified provider change and removes its unclaimed reward',async({page,request})=>{
 await request.post('http://127.0.0.1:4123/__fixture/reset',{data:{}});await request.post('http://127.0.0.1:4123/__fixture/journey');await page.goto('http://127.0.0.1:4123/');await expect(page.getByRole('region',{name:'Subscriber journey'})).toBeVisible();await page.getByRole('button',{name:'Skip',exact:true}).click();const d=page.getByRole('dialog');await expect(d.getByText(/Skipping this order restarts your five-order journey/)).toBeVisible();await d.getByRole('button',{name:'Review change',exact:true}).click();await d.getByRole('button',{name:'Confirm change',exact:true}).click();await expect(d).toHaveCount(0);await expect(page.getByRole('progressbar',{name:'Completed journey orders'})).toHaveAttribute('aria-valuenow','0');await request.post('http://127.0.0.1:4123/__fixture/journey-reconcile');const state=await(await request.get('http://127.0.0.1:4123/__fixture/state')).json();expect(state.writes).toBe(3);
});
