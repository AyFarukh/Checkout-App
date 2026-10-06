import '@shopify/ui-extensions/preact';
import {createElement as e,render} from 'preact';
import {useState} from 'preact/hooks';

export default function extension(){render(e(SubscriptionPage),document.body)}

function SubscriptionPage(){
  const settings=shopify.settings?.value||{};
  const apiBase=String(settings.api_base_url||'').replace(/\/$/,'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');

  async function openPortal(){
    if(!apiBase){setError('Subscription API URL has not been configured.');return}
    try{
      setBusy(true);setError('');
      const token=await shopify.sessionToken.get();
      const r=await fetch(`${apiBase}/api/subscriptions/portal-session`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
      const body=await r.json();
      if(!r.ok)throw new Error(body?.message||'Unable to open your subscription portal.');
      const url=`${apiBase}${body.portalUrl}`;
      open(url,'_blank');
    }catch(x){setError(x.message||'Unable to open your subscription portal.')}finally{setBusy(false)}
  }

  return e('s-page',{heading:'My Subscription'},e('s-stack',{direction:'block',gap:'base'},
    e('s-section',null,e('s-stack',{direction:'block',gap:'base'},
      e('s-heading',null,'FreeTheRoots Subscription Portal'),
      e('s-text',null,'View your upcoming order, products, delivery details and subscription settings in the full FreeTheRoots portal.'),
      e('s-button',{variant:'primary',loading:busy,onClick:openPortal},'Open subscription portal'),
      e('s-text',{tone:'subdued'},'Preview mode: subscription-changing actions are still disabled.')
    )),
    error?e('s-banner',{tone:'critical'},e('s-text',null,error)):null
  ));
}
