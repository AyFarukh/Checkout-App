import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createElement as h, render} from 'preact';
import {act} from 'preact/test-utils';
import ReferralSection from '../src/ReferralSection.js';

// Shopify's custom progress element reports zero before a value attribute exists.
// Preact treats that default as already applied, unlike its native <progress> path.
const {window, document, customElements, HTMLElement}=parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document});
customElements.define('s-progress',class extends HTMLElement {
  get value(){return Number(this.getAttribute('value')||0);}
  set value(value){this.setAttribute('value',String(value));}
});
globalThis.shopify={sessionToken:{get:async()=> 'test-session'}};

test('referral progress is determinate at zero, partial completion, and completion',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    const root=document.createElement('div');document.body.append(root);
    for(const [index,count] of [0,3,5,0].entries()) {
      globalThis.fetch=async()=>({ok:true,json:async()=>({enabled:true,qualifiedCount:count,program:{referrerPoints:200},milestones:[{id:'gift',threshold:5,kind:'PRODUCT',title:'Free Mist',unlocked:count>=5}]})});
      await act(async()=>{render(h(ReferralSection,{apiBase:`https://rewards.example/${index}`}),root);});
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
      const progress=root.querySelector('s-progress');
      if(count===0){
        assert.equal(progress,null,'zero referrals must not mount Shopify’s animated progress component');
        assert.ok(root.querySelector('s-divider'),'zero referrals must display a static empty track');
        continue;
      }
      assert.ok(progress,'positive referral progress must exist');
      assert.equal(progress.getAttribute('value'),String(count),`count ${count} must set an explicit value rather than animate as loading`);
      assert.equal(progress.getAttribute('max'),'5');
    }
    await act(()=>render(null,root));root.remove();
  }finally{globalThis.fetch=originalFetch;}
});
