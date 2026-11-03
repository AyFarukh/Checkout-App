import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const bundleDir=fileURLToPath(new URL('../fixtures/subscription-theme/',import.meta.url));
function failure(code,message){return Object.assign(new Error(message),{code});}
function isFile(path){try{return statSync(path).isFile();}catch{return false;}}

// An explicit checkout is never silently replaced: a wrong path or stale theme
// must not be reported as a passing test of that checkout.
export function resolveSubscriptionThemeAssets(env=process.env){
 const configured=String(env.FTR_THEME_ASSET||'').trim();
 const js=resolve(configured||resolve(bundleDir,'ftr-subscription-dashboard.js'));
 const source=configured?'checkout':'bundled';
 if(!isFile(js))throw failure('THEME_ASSET_NOT_FOUND',`Theme JavaScript does not exist: ${js}. Correct FTR_THEME_ASSET to an existing updated checkout, or run "unset FTR_THEME_ASSET" to test the bundled version. No browsers were started.`);
 const css=js.replace(/\.js$/,'.css');
 const javascript=readFileSync(js,'utf8');
 if(!['Review change','action-status','Product change'].every(marker=>javascript.includes(marker)))
  throw failure('THEME_ASSET_OUTDATED',`The theme at ${js} does not include the current subscription forms. Pull feature/loop-all-actions-confirmation-v1 in that checkout, or run "unset FTR_THEME_ASSET" to test the bundled version.`);
 if(css===js||!isFile(css))throw failure('THEME_STYLESHEET_NOT_FOUND',`The theme stylesheet is missing: ${css}. Keep the dashboard JavaScript and CSS together, or run "unset FTR_THEME_ASSET" to test the bundled version.`);
 if(source==='bundled'){
  const manifest=JSON.parse(readFileSync(resolve(bundleDir,'manifest.json'),'utf8'));
  for(const [name,path] of [['ftr-subscription-dashboard.js',js],['ftr-subscription-dashboard.css',css]]){
   const actual=createHash('sha256').update(readFileSync(path)).digest('hex');
   if(manifest.files[name]!==actual)throw failure('THEME_BUNDLE_CHANGED',`Bundled theme checksum mismatch for ${name}. Restore the pinned snapshot from feature/loop-action-adapter-v1; use FTR_THEME_ASSET to test a different checkout.`);
  }
 }
 return {js,css,source};
}
