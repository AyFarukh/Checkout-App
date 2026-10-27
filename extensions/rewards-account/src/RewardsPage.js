import '@shopify/ui-extensions/preact';
import {createElement as h,render} from 'preact';
import {useEffect,useState} from 'preact/hooks';

export default function extension(){render(h(RewardsPage),document.body);}
export function RewardsPage(){
 const settings=shopify.settings?.value||{},apiBase=String(settings.api_base_url||'').replace(/\/$/,''),title=settings.page_title||'Rewards';
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;
  async function load(){
   try{
    if(!apiBase)throw new Error('Rewards are being configured. Please check back soon.');
    setError('');const token=await shopify.sessionToken.get();
    const response=await fetch(`${apiBase}/api/customer/me`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)throw new Error('Unable to open rewards. Please try again.');
    const data=await response.json(),page=new URL(data.storefrontRewardsUrl);
    if(page.protocol!=='https:'||!/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.test(page.hostname)||page.pathname!=='/apps/ftr-welcome/rewards'||page.search||page.hash)throw new Error('The rewards page is not ready. Please contact the store.');
    if(active)setUrl(page.href);
   }catch(error){if(active)setError(error.message);}
  }
  load();return()=>{active=false;};
 },[apiBase,retry]);
 return h('s-page',{heading:title},h('s-section',{heading:'Your FreeTheRoots rewards'},
  h('s-stack',{direction:'block',gap:'base'},
   h('s-text',null,'View your points, redeem rewards, and invite friends on your rewards page.'),
   error?h('s-banner',{tone:'critical'},error):null,
   url?h('s-button',{href:url,variant:'primary',inlineSize:'fill'},'Open your rewards'):error?
    h('s-button',{onClick:()=>setRetry(retry+1)},'Try again'):h('s-spinner',{accessibilityLabel:'Opening your rewards'}))));
}
