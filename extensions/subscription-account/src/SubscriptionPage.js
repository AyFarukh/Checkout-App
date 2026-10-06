import '@shopify/ui-extensions/preact';
import {createElement as e,render} from 'preact';
import {useCallback,useEffect,useState} from 'preact/hooks';

export default function extension(){render(e(SubscriptionPage),document.body)}

function money(value,currency='USD'){
  const amount=Number(value||0);
  try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount)}
  catch{return `$${amount.toFixed(2)}`}
}
function date(value){
  if(!value)return 'Not scheduled';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function interval(policy){
  if(!policy)return 'Subscription';
  const n=Number(policy.intervalCount||policy.interval_count||1);
  const unit=String(policy.interval||'month').toLowerCase();
  return `Every ${n} ${unit}${n===1?'':'s'}`;
}
function SubscriptionPage(){
  const settings=shopify.settings?.value||{},apiBase=String(settings.api_base_url||'').replace(/\/$/,''),title=settings.page_title||'My subscription';
  const [data,setData]=useState(null),[error,setError]=useState('');
  const load=useCallback(async()=>{
    if(!apiBase){setError('Subscription API URL has not been configured yet.');return}
    try{
      setError('');
      const token=await shopify.sessionToken.get();
      const r=await fetch(`${apiBase}/api/subscriptions/subscription`,{headers:{Authorization:`Bearer ${token}`}});
      const body=await r.json();
      if(!r.ok)throw new Error(body?.message||'Unable to load your subscription right now.');
      setData(body);
    }catch(x){setError(x.message||'Unable to load your subscription.')}
  },[apiBase]);
  useEffect(()=>{load()},[load]);

  if(error)return e('s-page',{heading:title},e('s-stack',{direction:'block',gap:'base'},
    e('s-banner',{tone:'info'},e('s-text',null,error)),
    e('s-section',{heading:'Safe preview'},e('s-text',null,'The portal is read-only. Your existing Loop subscription has not been changed.'))
  ));
  if(!data)return e('s-page',{heading:title},e('s-section',null,e('s-stack',{direction:'block',gap:'small'},e('s-heading',null,'Loading your subscription'),e('s-spinner'))));

  const subscriptions=Array.isArray(data.subscriptions)?data.subscriptions:[],s=subscriptions[0];
  if(!s)return e('s-page',{heading:title},e('s-section',{heading:'No subscriptions found'},e('s-text',null,'There are no Loop subscriptions available for this customer.')));

  const lines=Array.isArray(s.lines)?s.lines:[],currency=s.currencyCode||'USD';
  return e('s-page',{heading:title},e('s-stack',{direction:'block',gap:'base'},
    e('s-banner',{tone:'info'},e('s-text',null,'Read-only test mode — subscription changes are disabled.')),
    e('s-section',{heading:'Next order'},e('s-stack',{direction:'block',gap:'small'},
      e('s-heading',null,date(s.nextBillingDate)),
      e('s-text',null,money(s.totalLineItemDiscountedPrice??s.totalLineItemPrice,currency)),
      ...lines.map(line=>e('s-box',{key:line.id||line.variantShopifyId,padding:'base',border:'base'},e('s-stack',{direction:'block',gap:'small'},
        e('s-heading',null,line.productTitle||line.name||'Subscription product'),
        line.variantTitle?e('s-text',null,line.variantTitle):null,
        e('s-text',null,`Qty ${line.quantity||1} · ${money(line.discountedPrice??line.price,currency)}`)
      )))
    )),
    e('s-section',{heading:'Subscription'},e('s-stack',{direction:'block',gap:'small'},
      e('s-text',null,`Status: ${s.status||'Unknown'}`),
      e('s-text',null,interval(s.billingPolicy))
    )),
    s.shippingAddress?e('s-section',{heading:'Shipping'},e('s-stack',{direction:'block',gap:'small'},
      e('s-text',null,[s.shippingAddress.firstName,s.shippingAddress.lastName].filter(Boolean).join(' ')),
      e('s-text',null,[s.shippingAddress.address1,s.shippingAddress.address2].filter(Boolean).join(', ')),
      e('s-text',null,[s.shippingAddress.city,s.shippingAddress.province,s.shippingAddress.zip].filter(Boolean).join(', '))
    )):null,
    e('s-section',{heading:'Manage subscription'},e('s-text',null,'Skip, reschedule, order now, product changes, pause and cancel are intentionally disabled during read-only verification.'))
  ));
}
