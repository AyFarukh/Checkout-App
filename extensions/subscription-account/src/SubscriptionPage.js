import '@shopify/ui-extensions/preact';
import {createElement as e,render} from 'preact';
import {useCallback,useEffect,useMemo,useState} from 'preact/hooks';

export default function extension(){render(e(SubscriptionPage),document.body)}

const text=(v,f='—')=>v===undefined||v===null||v===''?f:String(v);
function money(value,currency='USD'){const n=Number(value||0);try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(n)}catch{return `$${n.toFixed(2)}`}}
function date(value){if(!value)return 'Not scheduled';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
function interval(p){if(!p)return 'Subscription';const n=Number(p.intervalCount||p.interval_count||1),u=String(p.interval||'month').toLowerCase();return `Every ${n} ${u}${n===1?'':'s'}`}
function statusTone(status){return String(status||'').toUpperCase()==='ACTIVE'?'success':'neutral'}
function action(label,caption){return e('s-box',{padding:'base',border:'base',borderRadius:'base'},e('s-stack',{direction:'inline',gap:'base',alignItems:'center'},e('s-box',{inlineSize:'fill'},e('s-heading',null,label),e('s-text',{tone:'subdued'},caption)),e('s-button',{variant:'secondary',disabled:true},label)))}

function SubscriptionPage(){
 const settings=shopify.settings?.value||{},apiBase=String(settings.api_base_url||'').replace(/\/$/,''),title=settings.page_title||'My Subscription';
 const [data,setData]=useState(null),[error,setError]=useState('');
 const load=useCallback(async()=>{if(!apiBase){setError('Subscription API URL has not been configured yet.');return}try{setError('');const token=await shopify.sessionToken.get();const r=await fetch(`${apiBase}/api/subscriptions/subscription`,{headers:{Authorization:`Bearer ${token}`}});const body=await r.json();if(!r.ok)throw new Error(body?.message||'Unable to load your subscription right now.');setData(body)}catch(x){setError(x.message||'Unable to load your subscription.')}},[apiBase]);
 useEffect(()=>{load()},[load]);
 const subscriptions=Array.isArray(data?.subscriptions)?data.subscriptions:[],s=subscriptions[0],lines=Array.isArray(s?.lines)?s.lines:[],currency=s?.currencyCode||'USD';
 const total=useMemo(()=>s?money(s.totalLineItemDiscountedPrice??s.totalLineItemPrice,currency):'',[s,currency]);
 if(error)return e('s-page',{heading:title},e('s-stack',{direction:'block',gap:'base'},e('s-banner',{tone:'critical'},e('s-text',null,error)),e('s-button',{onClick:load},'Try again')));
 if(!data)return e('s-page',{heading:title},e('s-section',null,e('s-stack',{direction:'inline',gap:'base',alignItems:'center'},e('s-spinner'),e('s-text',null,'Loading your subscription…'))));
 if(!s)return e('s-page',{heading:title},e('s-section',{heading:'No subscriptions found'},e('s-text',null,'There are no Loop subscriptions available for this customer.')));

 const a=s.shippingAddress||{};
 return e('s-page',{heading:title},e('s-stack',{direction:'block',gap:'large'},
   e('s-banner',{tone:'info'},e('s-text',null,'Preview mode · Your subscription is safe. Changes are disabled while we finish verification.')),
   e('s-section',null,e('s-stack',{direction:'block',gap:'base'},
     e('s-stack',{direction:'inline',gap:'base',alignItems:'center'},e('s-box',{inlineSize:'fill'},e('s-text',{tone:'subdued'},'NEXT ORDER'),e('s-heading',null,date(s.nextBillingDate))),e('s-heading',null,total)),
     ...lines.map(line=>e('s-box',{key:line.id||line.variantShopifyId,padding:'base',border:'base',borderRadius:'base'},e('s-stack',{direction:'inline',gap:'base',alignItems:'center'},
       line.imageUrl||line.image?e('s-image',{src:line.imageUrl||line.image,alt:line.productTitle||line.name||'Subscription product',inlineSize:'80px',blockSize:'80px',objectFit:'cover'}):null,
       e('s-box',{inlineSize:'fill'},e('s-heading',null,line.productTitle||line.name||'Subscription product'),line.variantTitle?e('s-text',{tone:'subdued'},line.variantTitle):null,e('s-text',null,`Qty ${line.quantity||1} · ${money(line.discountedPrice??line.price,currency)}`))
     ))),
     e('s-stack',{direction:'inline',gap:'base'},e('s-button',{variant:'primary',disabled:true},'Order now'),e('s-button',{variant:'secondary',disabled:true},'Skip this order'),e('s-button',{variant:'secondary',disabled:true},'Reschedule'))
   )),
   e('s-section',{heading:'Your subscription'},e('s-stack',{direction:'block',gap:'base'},
     e('s-stack',{direction:'inline',gap:'base',alignItems:'center'},e('s-badge',{tone:statusTone(s.status)},text(s.status,'UNKNOWN')),e('s-text',null,interval(s.billingPolicy))),
     e('s-text',{tone:'subdued'},subscriptions.length>1?`${subscriptions.length} subscriptions found. Active subscriptions are shown first.`:'Subscription details and upcoming delivery preferences.')
   )),
   e('s-section',{heading:'Delivery & payment'},e('s-stack',{direction:'block',gap:'base'},
     e('s-box',{padding:'base',border:'base',borderRadius:'base'},e('s-heading',null,'Shipping address'),e('s-text',null,[a.firstName,a.lastName].filter(Boolean).join(' ')),e('s-text',null,[a.address1,a.address2].filter(Boolean).join(', ')),e('s-text',null,[a.city,a.province,a.zip].filter(Boolean).join(', '))),
     e('s-box',{padding:'base',border:'base',borderRadius:'base'},e('s-heading',null,'Payment method'),e('s-text',{tone:'subdued'},'Your saved subscription payment method is securely managed by Shopify and Loop.'))
   )),
   e('s-section',{heading:'Manage subscription'},e('s-stack',{direction:'block',gap:'small'},
     action('Change frequency','Adjust how often your subscription ships.'),
     action('Edit products','Update products or quantities in this subscription.'),
     action('Update shipping','Change the delivery address for future orders.'),
     action('Pause subscription','Temporarily stop future subscription orders.'),
     action('Cancel subscription','End future subscription renewals.')
   )),
   e('s-banner',{tone:'info'},e('s-text',null,'All management controls are currently disabled. This page is read-only and has not changed your Loop subscription.'))
 ));
}
