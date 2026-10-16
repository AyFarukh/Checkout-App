import '@shopify/ui-extensions/preact';
import {createElement as h,render} from 'preact';
import {useCallback,useEffect,useState} from 'preact/hooks';

export default function extension(){render(h(RewardsPage),document.body)}
const box=(children,props={})=>h('s-box',{padding:'base',border:'base',borderRadius:'large',...props},children);
const stack=(...children)=>h('s-stack',{direction:'block',gap:'base'},...children);
const row=(...children)=>h('s-stack',{direction:'inline',gap:'base',alignItems:'center'},...children);
const text=(value,props={})=>h('s-text',props,value);
const heading=(value)=>h('s-heading',null,value);
const badge=(value)=>h('s-badge',{tone:'success'},value);
const section=(title,body)=>h('s-section',{heading:title},body);
const grid=(items)=>h('s-grid',{gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))',gap:'base'},...items);
const eyebrow=(label)=>text(label,{color:'subdued'});
const format=n=>Number(n||0).toLocaleString();
const TIERS=[{name:'Seedling',min:0,description:'Welcome to the family',icon:'🌿'},{name:'Sprout',min:500,description:"You're starting to grow",icon:'🌱'},{name:'Rooted',min:1500,description:"You're growing strong",icon:'🌲'},{name:'Canopy',min:3000,description:'Top of the canopy',icon:'👑'}];
const RULES={PURCHASE:'Make a purchase',ACCOUNT_CREATE:'Create an account',BIRTHDAY:'Celebrate a birthday',REVIEW:'Write a review',REFERRAL:'Refer a friend',MANUAL:'Special bonus',BONUS:'Bonus points'};
const REWARD_ICONS={FREE_SHIPPING:'🚚',FIXED_DISCOUNT:'🏷️',PERCENTAGE_DISCOUNT:'🏷️',FREE_PRODUCT:'🎁'};
function RewardsPage(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[latest,setLatest]=useState(null),[confirm,setConfirm]=useState(null);
 const settings=shopify.settings?.value||{},apiBase=String(settings.api_base_url||'').replace(/\/$/,''),title=settings.page_title||'Rewards';
 const load=useCallback(async()=>{if(!apiBase){setError('Rewards are being configured. Please check back soon.');return}try{setError('');const token=await shopify.sessionToken.get(),r=await fetch(`${apiBase}/api/customer/me`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Unable to load your rewards right now.');setData(await r.json())}catch(x){setError(x.message||'Unable to load rewards.')}},[apiBase]);
 useEffect(()=>{load()},[load]);
 async function redeem(reward){try{setBusy(reward._id);setError('');const token=await shopify.sessionToken.get(),r=await fetch(`${apiBase}/api/customer/redemptions/reserve`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':`account:${reward._id}:${Date.now()}:${Math.random().toString(36).slice(2)}`},body:JSON.stringify({rewardId:reward._id})}),result=await r.json();if(!r.ok)throw new Error(result?.error?.message||result?.error||'Reward could not be redeemed.');setLatest(result.redemption||null);shopify.toast?.show?.('Reward redeemed. Your discount code is ready.');await load()}catch(x){setError(x.message||'Reward could not be redeemed.')}finally{setBusy('');setConfirm(null)}}
 async function copyCode(code){try{await navigator.clipboard.writeText(code);shopify.toast?.show?.('Discount code copied')}catch{shopify.toast?.show?.('Copy the discount code shown on screen')}}
 if(error&&!data)return h('s-page',{heading:title},h('s-banner',{tone:'critical'},error));
 if(!data)return h('s-page',{heading:title},section('Your rewards',stack(text('Loading your rewards…'),h('s-spinner'))));
 const c=data.customer||{},points=Number(c.pointsBalance||0),lifetime=Number(c.lifetimeEarned||0),rewards=data.rewards||[],rules=data.rules||[],activity=(data.activity||[]).slice(0,8),active=(data.redemptions||[]).filter(r=>r.status==='RESERVED'&&r.discountCode);
 const tier=TIERS.reduce((a,t)=>lifetime>=t.min?t:a,TIERS[0]),index=TIERS.indexOf(tier),next=TIERS[index+1],progress=next?Math.max(0,Math.min(100,Math.round((lifetime-tier.min)/(next.min-tier.min)*100))):100;
 const customerName=String(c.firstName||'').trim()||'friend';
 const memberCard=box(stack(eyebrow('YOUR ROOT REWARDS BALANCE'),heading('Hi '+customerName+' 👋'),heading(format(points)+' POINTS'),row(badge(tier.icon+' '+tier.name+' Member'),text('Available to redeem')),Number(c.pointsReserved)>0?eyebrow(format(c.pointsReserved)+' points reserved for rewards'):null),{background:'subdued'});
 const tierProgress=box(stack(row(text('YOUR TIER · '+format(lifetime)+' LIFETIME PTS'),badge(tier.name)),heading(next?'Next tier: '+next.name:'You reached Canopy!'),h('s-progress',{value:progress,max:100}),text(next?format(progress)+'% complete · '+format(next.min-lifetime)+' lifetime points to '+next.name:'100% complete · You have unlocked the highest tier.')));
 const tierCards=grid(TIERS.map(t=>box(stack(row(text(t.icon),heading(t.name),t.name===tier.name?badge('CURRENT TIER'):null),text(t.description),eyebrow(format(t.min)+' lifetime points to unlock')),{background:t.name===tier.name?'subdued':undefined})));
 const visibleRules=rules.filter(r=>!['MANUAL','BONUS'].includes(String(r.type||'').toUpperCase())&&(Number(r.points||0)>0||Number(r.pointsPerDollar||0)>0));
 const ruleCards=visibleRules.length?grid(visibleRules.map(r=>box(stack(row(text('🌿'),heading(RULES[r.type]||r.name)),text(r.name),badge(r.pointsPerDollar?format(r.pointsPerDollar)+' pt / $1':format(r.points)+' pts'))))):box(text('New ways to earn will appear here when enabled.'));
 const rewardCards=rewards.length?grid(rewards.map(r=>{const enough=points>=Number(r.pointsCost),synced=r.shopifySync?.status==='SYNCED';return box(stack(row(text(REWARD_ICONS[r.type]||'🎁'),heading(r.name)),text(r.type==='FREE_SHIPPING'?'Enjoy free shipping on an eligible order':r.type==='FREE_PRODUCT'?'Redeem for a free eligible product':'Save on your next eligible order'),badge(format(r.pointsCost)+' points'),!enough?eyebrow(format(Math.max(0,Number(r.pointsCost)-points))+' more points to unlock'):null,h('s-button',{variant:enough?'primary':'secondary',disabled:!enough||Boolean(busy)||!synced,loading:busy===r._id,onClick:()=>setConfirm(r)},!synced?'Coming soon':enough?'Redeem reward':'🔒 Keep earning')))})):box(text('No rewards are available yet.'));
 const activityCards=activity.length?stack(...activity.map(i=>box(row(stack(text(i.reason||i.source||i.type),text(new Date(i.createdAt).toLocaleDateString())),badge((i.points>0?'+':'')+format(i.points)+' pts'))))):box(text('Your points activity will appear here.'));
 return h('s-page',{heading:title},stack(error?h('s-banner',{tone:'critical'},error):null,latest?.discountCode?h('s-banner',{tone:'success'},stack(heading('Reward redeemed!'),text('Your code: '+latest.discountCode),h('s-button',{onClick:()=>copyCode(latest.discountCode)},'Copy code'))):null,section('YOUR ACCOUNT',memberCard),tierProgress,section('YOUR MEMBERSHIP JOURNEY',tierCards),section('WAYS TO EARN POINTS',ruleCards),section('REDEEM YOUR POINTS',rewardCards),active.length?section('ACTIVE REWARDS',stack(...active.map(r=>box(stack(heading(r.discountCode),text('Expires '+new Date(r.expiresAt).toLocaleString()),h('s-button',{onClick:()=>copyCode(r.discountCode)},'Copy code')))))):null,section('RECENT ACTIVITY',activityCards),confirm?h('s-modal',{open:true,heading:'Confirm redemption',onClose:()=>setConfirm(null)},stack(text('Redeem '+confirm.name+' for '+format(confirm.pointsCost)+' points?'),text('Your points will be reserved until the reward is used or released.'),row(h('s-button',{variant:'secondary',onClick:()=>setConfirm(null)},'Cancel'),h('s-button',{variant:'primary',loading:busy===confirm._id,onClick:()=>redeem(confirm)},'Confirm redemption')))):null));
}
