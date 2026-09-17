import '@shopify/ui-extensions/preact';
import {createElement as e, render} from 'preact';
import {useCallback, useEffect, useMemo, useState} from 'preact/hooks';

export default function extension(){render(e(CheckoutRewards),document.body)}

function CheckoutRewards(){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[applied,setApplied]=useState('');
  const settings=shopify.settings?.value||{};
  const apiBase=String(settings.api_base_url||'').replace(/\/$/,'');
  const heading=settings.heading||'FreeTheRoots Rewards';
  const checkoutToken=shopify.checkoutToken?.value?.token||shopify.checkoutToken?.value||null;

  const load=useCallback(async()=>{
    if(!apiBase){setError('Rewards are being configured.');return}
    try{
      setError('');
      const token=await shopify.sessionToken.get();
      const response=await fetch(`${apiBase}/api/customer/me`,{headers:{Authorization:`Bearer ${token}`}});
      if(response.status===401||response.status===403){setData({guest:true});return}
      if(!response.ok)throw new Error('Unable to load rewards right now.');
      setData(await response.json());
    }catch(x){setError(x.message||'Unable to load rewards.');}
  },[apiBase]);

  useEffect(()=>{load()},[load]);

  const active=useMemo(()=>((data?.redemptions||[]).filter(r=>r.status==='RESERVED'&&r.discountCode)),[data]);
  const points=Number(data?.customer?.pointsBalance||0);

  async function applyCode(code){
    const canUpdate=shopify.instructions?.value?.discounts?.canUpdateDiscountCodes;
    if(canUpdate===false)throw new Error('Discount codes cannot be updated in this checkout.');
    const result=await shopify.applyDiscountCodeChange({type:'addDiscountCode',code});
    if(result?.type==='error')throw new Error(result.message||'The reward code could not be applied.');
    setApplied(code);
  }

  async function redeem(reward){
    try{
      setBusy(reward._id);setError('');
      // The rewards backend creates a customer-specific, one-use code. The discount
      // itself is non-combinable, enforcing the client's one-reward-per-order policy.
      const token=await shopify.sessionToken.get();
      const response=await fetch(`${apiBase}/api/customer/redemptions/reserve`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':`checkout:${checkoutToken||'unknown'}:${reward._id}`},
        body:JSON.stringify({rewardId:reward._id,cartId:checkoutToken||undefined})
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result?.error?.message||result?.error||'Reward could not be redeemed.');
      const code=result?.redemption?.discountCode;
      if(!code)throw new Error('Reward was reserved but no discount code was returned.');
      await applyCode(code);
      await load();
    }catch(x){setError(x.message||'Reward could not be applied.');}
    finally{setBusy('');}
  }

  async function applyExisting(code){try{setBusy(code);setError('');await applyCode(code)}catch(x){setError(x.message||'Reward could not be applied.')}finally{setBusy('')}}

  if(!apiBase)return e('s-banner',{tone:'warning'},'Checkout rewards are being configured.');
  if(!data&&!error)return e('s-stack',{direction:'block',gap:'small'},e('s-heading',null,heading),e('s-spinner'));
  if(data?.guest)return e('s-banner',null,'Sign in to your customer account to use FreeTheRoots reward points.');
  if(error&&!data)return e('s-banner',{tone:'critical'},error);

  const rewards=data?.rewards||[];
  return e('s-stack',{direction:'block',gap:'base'},
    e('s-heading',null,heading),
    e('s-text',null,`You have ${points.toLocaleString()} points.`),
    error?e('s-banner',{tone:'critical'},error):null,
    applied?e('s-banner',{tone:'success'},`Reward applied: ${applied}`):null,
    active.length?e('s-stack',{direction:'block',gap:'small'},
      e('s-text',null,'Your reserved reward'),
      ...active.map(r=>e('s-button',{key:r._id,disabled:Boolean(busy),loading:busy===r.discountCode,onClick:()=>applyExisting(r.discountCode)},`Apply ${r.discountCode}`))
    ):null,
    rewards.length?e('s-stack',{direction:'block',gap:'small'},...rewards.map(r=>{
      const cost=Number(r.pointsCost||0),eligible=points>=cost&&!active.length;
      return e('s-box',{key:r._id,padding:'base',border:'base'},
        e('s-stack',{direction:'block',gap:'small'},
          e('s-heading',null,r.name),
          e('s-text',null,`${cost.toLocaleString()} points`),
          e('s-button',{disabled:!eligible||Boolean(busy),loading:busy===r._id,onClick:()=>redeem(r)},active.length?'Use your reserved reward':eligible?'Redeem & apply':'Keep earning')
        )
      )
    })):e('s-text',null,'No rewards are currently available.')
  );
}
