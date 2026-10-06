import '@shopify/ui-extensions/preact';
import {createElement as e,render} from 'preact';
import {useCallback,useEffect,useState} from 'preact/hooks';
export default function extension(){render(e(SubscriptionPage),document.body)}
const pick=(o,...k)=>k.map(x=>o?.[x]).find(v=>v!==undefined&&v!==null&&v!=='');
const money=(v,c='USD')=>{const n=Number(v||0);try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n)}catch{return '$'+n.toFixed(2)}};
const date=v=>{if(!v)return'Not scheduled';const d=new Date(v);return isNaN(d)?String(v):d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})};
function SubscriptionPage(){
 const settings=shopify.settings?.value||{},apiBase=String(settings.api_base_url||'').replace(/\/$/,'');
 const[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=useCallback(async()=>{if(!apiBase){setError('Subscription API URL is not configured.');return}try{setError('');const token=await shopify.sessionToken.get(),r=await fetch(`${apiBase}/api/subscriptions/subscription`,{headers:{Authorization:`Bearer ${token}`}}),b=await r.json();if(!r.ok)throw Error(b.message||'Unable to load subscription.');setData(b)}catch(x){setError(x.message||'Unable to load subscription.')}},[apiBase]);
 useEffect(()=>{load()},[load]);
 function confirmAction(action,label){setBusy(action);shopify.toast?.show?.(`${label} requires confirmation. Changes remain disabled until test verification is complete.`);setTimeout(()=>setBusy(''),500)}
 if(error&&!data)return e('s-page',{heading:'My Subscription'},e('s-banner',{tone:'critical'},error));
 if(!data)return e('s-page',{heading:'My Subscription'},e('s-section',null,e('s-stack',{direction:'block',gap:'small'},e('s-heading',null,'Loading your subscription'),e('s-spinner'))));
 const s=(data.subscriptions||[])[0];if(!s)return e('s-page',{heading:'My Subscription'},e('s-section',null,e('s-text',null,'No subscriptions found.')));
 const lines=Array.isArray(s.lines)?s.lines:[],cur=pick(s,'currencyCode','currency')||'USD',next=pick(s,'nextBillingDate','nextBillingAt','nextOrderDate','nextOrderAt','billingDate'),freq=s.billingPolicy||{},addr=s.shippingAddress||{};
 const linePrice=l=>pick(l,'discountedPrice','price','sellingPrice','linePrice','amount')||0,total=pick(s,'totalLineItemDiscountedPrice','totalLineItemPrice','totalPrice','subtotalPrice','price','billingAmount')??lines.reduce((n,l)=>n+Number(linePrice(l))*Number(l.quantity||1),0);
 const button=(id,label,tone)=>e('s-button',{key:id,variant:tone||'secondary',loading:busy===id,onClick:()=>confirmAction(id,label)},label);
 return e('s-page',{heading:'My Subscription'},e('s-stack',{direction:'block',gap:'base'},
  e('s-banner',{tone:'success'},e('s-stack',{direction:'block',gap:'small'},e('s-heading',null,`Your subscription is ${String(s.status||'active').toLowerCase()}`),e('s-text',null,'Manage your subscription, update your details, and more.'))),
  e('s-section',{heading:'Next order'},e('s-stack',{direction:'block',gap:'base'},e('s-heading',null,date(next)),e('s-heading',null,money(total,cur)),...lines.slice(0,5).map((l,i)=>e('s-box',{key:l.id||i,padding:'base',border:'base'},e('s-stack',{direction:'inline',gap:'base'},pick(l,'imageUrl','image','productImage')?e('s-image',{src:pick(l,'imageUrl','image','productImage'),alt:pick(l,'productTitle','name')||'Product'}):null,e('s-stack',{direction:'block',gap:'small'},e('s-heading',null,pick(l,'productTitle','name')||'Subscription product'),e('s-text',null,`Qty ${l.quantity||1} · ${money(linePrice(l),cur)}`))))),e('s-stack',{direction:'inline',gap:'small'},button('manage','Manage next order','primary'),button('order','Order now'),button('gift','Gift'),button('skip','Skip'),button('reschedule','Reschedule'),button('delay','Delay')))),
  e('s-section',{heading:'Your subscription'},e('s-stack',{direction:'block',gap:'small'},e('s-text',null,`Status: ${s.status||'Unknown'}`),e('s-text',null,`Deliver every ${freq.intervalCount||freq.interval_count||1} ${String(freq.interval||'month').toLowerCase()}`),button('products','Edit products'),button('frequency','Change frequency'),button('next','Change next order'),button('pause','Pause subscription'),button('cancel','Cancel subscription'))),
  e('s-section',{heading:'Payment details'},e('s-stack',{direction:'block',gap:'small'},e('s-text',null,'Payment method is securely managed by Shopify and Loop.'),button('payment','Update payment method'))),
  e('s-section',{heading:'Shipping address'},e('s-stack',{direction:'block',gap:'small'},e('s-text',null,[addr.firstName,addr.lastName,addr.address1,addr.address2,addr.city,addr.province,addr.zip,addr.country].filter(Boolean).join(', ')||'No shipping address available.'),button('address','Edit address'))),
  e('s-banner',{tone:'info'},e('s-text',null,'Safety mode is active. Every subscription-changing action will show a confirmation step before the API request, and live changes remain disabled until test verification is complete.'))
 ))}