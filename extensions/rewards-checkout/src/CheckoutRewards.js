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
  const rewards=data?.rewards||[];
  const affordable=rewards.filter(r=>points>=Number(r.pointsCost||0));
  const nextReward=useMemo(()=>rewards
    .filter(r=>Number(r.pointsCost||0)>points)
    .sort((a,b)=>Number(a.pointsCost||0)-Number(b.pointsCost||0))[0],[rewards,points]);

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

  async function applyExisting(code){
    try{setBusy(code);setError('');await applyCode(code)}
    catch(x){setError(x.message||'Reward could not be applied.')}
    finally{setBusy('')}
  }

  if(!apiBase)return e('s-banner',{tone:'warning'},'Checkout rewards are being configured.');
  if(!data&&!error)return e('s-box',{padding:'base',border:'base'},
    e('s-stack',{direction:'block',gap:'small'},e('s-heading',null,heading),e('s-spinner'))
  );
  if(data?.guest)return e('s-box',{padding:'base',border:'base'},
    e('s-stack',{direction:'block',gap:'small'},
      e('s-heading',null,heading),
      e('s-text',null,'Sign in to use your reward points at checkout.')
    )
  );
  if(error&&!data)return e('s-banner',{tone:'critical'},error);

  return e('s-box',{padding:'base',border:'base'},
    e('s-stack',{direction:'block',gap:'base'},
      e('s-stack',{direction:'block',gap:'small'},
        e('s-heading',null,heading),
        e('s-text',{emphasis:'bold'},`${points.toLocaleString()} points available`),
        nextReward?e('s-text',{tone:'subdued'},`${(Number(nextReward.pointsCost||0)-points).toLocaleString()} more points until ${nextReward.name}.`):
          rewards.length?e('s-text',{tone:'subdued'},'You can unlock any reward below.'):null
      ),

      error?e('s-banner',{tone:'critical'},error):null,
      applied?e('s-banner',{tone:'success'},`Reward applied successfully: ${applied}`):null,

      active.length?e('s-stack',{direction:'block',gap:'small'},
        e('s-heading',null,'Reserved reward'),
        e('s-text',{tone:'subdued'},'You already redeemed a reward. Apply it to this checkout before choosing another.'),
        ...active.map(r=>e('s-box',{key:r._id,padding:'base',border:'base'},
          e('s-stack',{direction:'block',gap:'small'},
            e('s-text',{emphasis:'bold'},r.discountCode),
            e('s-button',{variant:'primary',disabled:Boolean(busy),loading:busy===r.discountCode,onClick:()=>applyExisting(r.discountCode)},'Apply reserved reward')
          )
        ))
      ):null,

      !active.length&&rewards.length?e('s-stack',{direction:'block',gap:'small'},
        e('s-heading',null,'Choose a reward'),
        e('s-text',{tone:'subdued'},affordable.length?
          `${affordable.length} reward${affordable.length===1?' is':'s are'} available with your current balance.`:
          'Keep earning points to unlock a reward.'),
        ...rewards.map(r=>{
          const cost=Number(r.pointsCost||0);
          const eligible=points>=cost;
          const remaining=Math.max(0,cost-points);
          return e('s-box',{key:r._id,padding:'base',border:'base'},
            e('s-stack',{direction:'block',gap:'small'},
              e('s-heading',null,r.name),
              r.description?e('s-text',{tone:'subdued'},r.description):null,
              e('s-text',{emphasis:'bold'},`${cost.toLocaleString()} points`),
              !eligible?e('s-text',{tone:'subdued'},`You need ${remaining.toLocaleString()} more points.`):null,
              e('s-button',{
                variant:eligible?'primary':'secondary',
                disabled:!eligible||Boolean(busy),
                loading:busy===r._id,
                onClick:()=>redeem(r)
              },eligible?'Redeem & apply':'Keep earning')
            )
          )
        })
      ):null,

      !rewards.length&&!active.length?e('s-text',{tone:'subdued'},'No rewards are currently available.'):null,
      e('s-text',{tone:'subdued'},'Only one reward can be used per order.')
    )
  );
}
