import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {resolveSubscriptionThemeAssets} from './support/subscription-theme-assets.js';

test('default theme assets are bundled and verified without a sibling repository',()=>{
 const assets=resolveSubscriptionThemeAssets({});
 assert.equal(assets.source,'bundled');assert.ok(isAbsolute(assets.js));assert.ok(readFileSync(assets.js,'utf8').includes('Review change'));
 assert.ok(readFileSync(assets.css,'utf8').includes('ftr-sub__dialog'));
});
test('an explicit nonexistent theme path fails before starting any browser',()=>{
 assert.throws(()=>resolveSubscriptionThemeAssets({FTR_THEME_ASSET:'/does-not-exist/ftr-subscription-dashboard.js'}),e=>e.code==='THEME_ASSET_NOT_FOUND'&&/unset FTR_THEME_ASSET/.test(e.message));
});
test('an outdated local theme gives the correct branch and no silent fallback',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ftr-theme old '));
 try{
  const path=join(dir,'dashboard.js');writeFileSync(path,'// Test-only validation. Validate action. Confirm reschedule');writeFileSync(join(dir,'dashboard.css'),'');
  assert.throws(()=>resolveSubscriptionThemeAssets({FTR_THEME_ASSET:path}),e=>e.code==='THEME_ASSET_OUTDATED'&&/feature\/loop-all-actions-confirmation-v1/.test(e.message));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('an explicit theme path with spaces works and requires its adjacent stylesheet',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ftr-theme current '));
 try{
  const bundled=resolveSubscriptionThemeAssets({}),path=join(dir,'dashboard.js');writeFileSync(path,readFileSync(bundled.js));
  assert.throws(()=>resolveSubscriptionThemeAssets({FTR_THEME_ASSET:path}),e=>e.code==='THEME_STYLESHEET_NOT_FOUND');
  writeFileSync(join(dir,'dashboard.css'),readFileSync(bundled.css));
  const assets=resolveSubscriptionThemeAssets({FTR_THEME_ASSET:path});assert.equal(assets.js,path);assert.equal(assets.source,'checkout');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
