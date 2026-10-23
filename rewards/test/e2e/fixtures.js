import {test as base,expect} from '@playwright/test';
// Some restricted CI environments require single-process Chromium, which exits
// when its only context closes. Give each test its own browser in that mode.
export const test=process.env.FTR_CHROMIUM_SINGLE_PROCESS==='true'?base.extend({
 page:async({playwright,browserName,launchOptions},use)=>{
  const browser=await playwright[browserName].launch(launchOptions);
  try{const context=await browser.newContext();await use(await context.newPage());}finally{await browser.close();}
 }
}):base;
export {expect};
