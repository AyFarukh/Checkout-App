import '@shopify/ui-extensions/preact';
import {createElement as h,render} from 'preact';
import {useCallback,useEffect,useRef,useState} from 'preact/hooks';
import {checkoutRewardsModel,estimatedPurchasePoints,usableReservation} from './model.mjs';

export default function extension(){render(h(CheckoutRewards),document.body);}
const text=(value,props={})=>h('s-text',props,value);
const stack=(children,props={})=>h('s-stack',{direction:'block',gap:'base',...props},...children);
const fmt=value=>Number(value||0).toLocaleString();

export function CheckoutRewards(){
 const settings=shopify.settings?.value||{},apiBase=String(settings.api_base_url||'').replace(/\/$/,''),heading=settings.heading||'FreeTheRoots Rewards';
 const buyerId=shopify.buyerIdentity?.customer?.value?.id||'',checkoutToken=shopify.checkoutToken?.value?.token||shopify.checkoutToken?.value||null;
 const identity=`${apiBase}:${buyerId}:${checkoutToken||''}`,identityRef=useRef(identity);identityRef.current=identity;
 const [profile,setProfile]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[added,setAdded]=useState(''),[expanded,setExpanded]=useState(false),[issued,setIssued]=useState(null);
 const pending=useRef(new Map()),lock=useRef(false);
 const data=profile?.identity===identity?profile.data:null;
 const subtotal=shopify.cost?.subtotalAmount?.value;
 const canUpdate=shopify.instructions?.value?.discounts?.canUpdateDiscountCodes!==false;
 const appliedCodes=shopify.discountCodes?.value||[];
 const load=useCallback(async()=>{
  if(!apiBase)return null;
  try{
   const token=await shopify.sessionToken.get(),response=await fetch(`${apiBase}/api/customer/me`,{headers:{Authorization:`Bearer ${token}`}});
   if(identityRef.current!==identity)return null;
   if(response.status===401||response.status===403){setProfile({identity,data:{guest:true}});return null;}
   if(!response.ok)throw new Error('Unable to load rewards right now.');
   const result=await response.json();if(identityRef.current!==identity)return null;
   setProfile({identity,data:result});
   setIssued(current=>{
    if(current?.identity!==identity)return current;
    const reference=current.reservation.publicReference||String(current.reservation._id||'');
    const found=(result.redemptions||[]).some(item=>reference?reference===(item.publicReference||String(item._id||'')):current.reservation.discountCode&&item.discountCode===current.reservation.discountCode);
    return found?null:current;
   });return result;
  }catch(error){if(identityRef.current===identity)setError(error.message||'Unable to load rewards.');return null;}
 },[apiBase,identity]);
 useEffect(()=>{setError('');setAdded('');setExpanded(false);setIssued(null);pending.current.clear();lock.current=false;setBusy('');load();return()=>{if(identityRef.current===identity)identityRef.current='';};},[load,identity]);
 async function applyCode(code){
  if(shopify.instructions?.value?.discounts?.canUpdateDiscountCodes===false)throw new Error('Discount codes cannot be updated in this checkout.');
  const result=await shopify.applyDiscountCodeChange({type:'addDiscountCode',code});
  if(identityRef.current!==identity)return;
  if(result?.type==='error')throw new Error(result.message||'The reward code could not be added.');
  setAdded(code);
 }
 async function redeem(reward){
  if(lock.current||!checkoutToken||shopify.instructions?.value?.discounts?.canUpdateDiscountCodes===false)return;lock.current=true;setBusy(reward._id);setError('');
  let reservation;
  try{
   if(!pending.current.has(reward._id))pending.current.set(reward._id,`checkout:${checkoutToken}:${buyerId}:${reward._id}`);
   const token=await shopify.sessionToken.get();if(identityRef.current!==identity)return;
   const response=await fetch(`${apiBase}/api/customer/redemptions/reserve`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':pending.current.get(reward._id)},body:JSON.stringify({rewardId:reward._id,cartId:checkoutToken||undefined})});
   const result=await response.json();if(identityRef.current!==identity)return;
   if(!response.ok)throw new Error(result.error?.message||result.error||'Reward could not be redeemed.');
   reservation=result.redemption;
   if(reservation?.status==='RESERVED')setIssued({identity,reservation});
   if(!usableReservation(reservation)){
    const reference=reservation?.publicReference||reservation?._id;
    if(reference&&['RELEASED','CANCELLED','COMMITTED','REFUNDED'].includes(reservation?.status))pending.current.set(reward._id,`checkout:${checkoutToken}:${buyerId}:${reward._id}:retry:${reference}`);
    throw new Error(reservation?.expiresAt&&Date.parse(reservation.expiresAt)<=Date.now()?'This reward reservation has expired. Refresh your rewards and try again.':reservation?.status==='RESERVED'?'Your reward is still being prepared. Please try again shortly.':'The previous reward attempt is no longer available. Please try again.');
   }
   // Keep the code recoverable even if applying it or refreshing the wallet fails.
   setIssued({identity,reservation});pending.current.delete(reward._id);
   await applyCode(reservation.discountCode);
  }catch(error){if(identityRef.current===identity)setError(error.message||'Reward could not be applied.');}
  finally{
   if(identityRef.current===identity){await load();if(identityRef.current===identity){lock.current=false;setBusy('');}}
  }
 }
 async function applyExisting(code){
  if(lock.current||!canUpdate)return;lock.current=true;setBusy(code);setError('');
  try{await applyCode(code);}catch(error){if(identityRef.current===identity)setError(error.message||'Reward could not be applied.');}
  finally{if(identityRef.current===identity){lock.current=false;setBusy('');}}
 }
 const shell=children=>h('s-box',{padding:'large',background:'subdued',border:'base',borderRadius:'large'},stack(children,{gap:'large'}));
 if(!apiBase)return shell([h('s-heading',null,heading),text('Checkout rewards are being configured.')]);
 if(!data)return shell([h('s-heading',null,heading),error?h('s-banner',{tone:'critical'},error):h('s-spinner',{accessibilityLabel:'Loading rewards'}),error?h('s-button',{onClick:()=>{setError('');load();}},'Try again'):null]);
 if(data.guest)return shell([h('s-heading',null,heading),text('Sign in to use your reward points at checkout.')]);
 const model=checkoutRewardsModel(data,expanded),estimate=estimatedPurchasePoints(data.rules,subtotal,data.currencyCode);
 const reservations=[...(data.redemptions||[]),...(issued?.identity===identity?[issued.reservation]:[])];
 const preparing=reservations.some(r=>r.status==='RESERVED'&&!r.discountCode&&(!r.expiresAt||Date.parse(r.expiresAt)>Date.now()));
 const active=reservations.filter((r,i,all)=>usableReservation(r)&&all.findIndex(item=>item.discountCode===r.discountCode)===i);
 const isAdded=code=>shopify.discountCodes?appliedCodes.some(item=>item.code?.toLowerCase()===code.toLowerCase()):added===code;
 const header=h('s-grid',{gridTemplateColumns:'auto minmax(0, 1fr) auto',gap:'base',alignItems:'center'},
  h('s-box',{padding:'base',background:'base',borderRadius:'max'},h('s-image',{src:`${apiBase}/rewards-leaf.svg`,alt:'',inlineSize:'28px'})),
  stack([h('s-heading',null,heading),text(`${model.tier} member`,{color:'subdued'})],{gap:'small'}),
  stack([h('s-heading',null,fmt(model.points)),text('points',{color:'subdued'})],{gap:'small',alignItems:'end'}));
 const tiles=model.visible.map(reward=>h('s-clickable',{key:reward._id,background:'base',border:'base',borderRadius:'large',padding:'base',inlineSize:'100%',disabled:Boolean(busy)||!canUpdate||!checkoutToken,accessibilityLabel:`Redeem ${reward.label} for ${fmt(reward.pointsCost)} points`,onClick:()=>redeem(reward)},
  stack([h('s-heading',null,reward.label),text(`${fmt(reward.pointsCost)} pts`,{color:'subdued'})],{gap:'small',alignItems:'center'})));
 return shell([
  header,h('s-divider'),
  model.next?text([text(`${fmt(model.next.pointsCost-model.points)} points`,{type:'strong',tone:'success'}),text(` away from ${model.next.label}${/\boff$/i.test(model.next.label)?' your next order':'.'}`)]):null,
  error?h('s-banner',{tone:'critical'},error):null,
  !checkoutToken?text('Rewards are not ready for this checkout. Please refresh checkout.',{color:'subdued'}):null,
  !canUpdate?text('Rewards cannot be changed in this checkout.',{color:'subdued'}):null,
  added&&isAdded(added)?h('s-banner',{tone:'success'},'Reward code added to checkout.'):null,
  preparing?stack([h('s-heading',null,'Preparing your reward'),text('Your points are reserved while your discount code is prepared.'),h('s-button',{disabled:Boolean(busy),onClick:()=>{setError('');load();}},'Check again')],{gap:'small'}):active.length?stack([h('s-heading',null,'Your reserved reward'),...active.map(reservation=>h('s-box',{key:reservation.discountCode,padding:'base',background:'base',border:'base',borderRadius:'base'},stack([
   text(reservation.discountCode,{type:'strong'}),h('s-button',{variant:'primary',disabled:Boolean(busy)||!canUpdate||isAdded(reservation.discountCode),loading:busy===reservation.discountCode,onClick:()=>applyExisting(reservation.discountCode)},isAdded(reservation.discountCode)?'Added to checkout':'Apply reserved reward')
  ],{gap:'small'})))],{gap:'base'}):
   stack([h('s-heading',null,'Redeem points on this order'),
    tiles.length?h('s-grid',{gridTemplateColumns:'repeat(3, minmax(0, 1fr))',gap:'base'},...tiles):text('Keep earning points to unlock an order discount.',{color:'subdued'}),
    model.eligible.length>3?h('s-clickable',{disabled:Boolean(busy),inlineSize:'100%',paddingBlock:'small',accessibilityLabel:expanded?'Show fewer rewards':`See all ${model.eligible.length} rewards you qualify for`,onClick:()=>setExpanded(!expanded)},
     h('s-stack',{direction:'inline',gap:'small',alignItems:'center',justifyContent:'center'},text(expanded?'Show fewer':`See all ${model.eligible.length} rewards you qualify for`,{tone:'success',type:'strong'}),h('s-icon',{type:expanded?'chevron-up':'chevron-down',tone:'success'}))):null
   ],{gap:'base'}),
  text(estimate==null?'Points are calculated after your order is paid.':`Estimated ${fmt(estimate)} points with this order`,{tone:'success'}),
 ]);
}
