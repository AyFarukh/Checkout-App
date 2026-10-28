const amount=value=>{const number=Number(value||0);return Number.isFinite(number)?number:0;};
export function rewardLabel(reward,currencyCode){
 const value=amount(reward.discountValue);
 if(reward.type==='PERCENTAGE_DISCOUNT'&&value>0)return `${value}% off`;
 if(reward.type==='FIXED_DISCOUNT'&&value>0&&currencyCode){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:currencyCode,minimumFractionDigits:0,maximumFractionDigits:2,currencyDisplay:'narrowSymbol'}).format(value)+' off';}catch{}}
 return reward.name||'Order discount';
}
export function checkoutRewardsModel(data={},expanded=false){
 const points=Math.max(0,amount(data.customer?.pointsBalance)),lifetime=amount(data.customer?.lifetimeEarned);
 const tier=lifetime>=3000?'Canopy':lifetime>=1500?'Rooted':lifetime>=500?'Sprout':'Seedling';
 const catalogue=(data.rewards||[]).filter(reward=>['FIXED_DISCOUNT','PERCENTAGE_DISCOUNT'].includes(reward.type)&&amount(reward.pointsCost)>0&&reward.shopifySync?.status==='SYNCED'&&Number(reward.shopifySync.syncedVersion)===Number(reward.version||1)).map(reward=>({...reward,label:rewardLabel(reward,data.currencyCode)}));
 const eligible=catalogue.filter(reward=>amount(reward.pointsCost)<=points).sort((a,b)=>amount(b.pointsCost)-amount(a.pointsCost));
 const next=catalogue.filter(reward=>amount(reward.pointsCost)>points).sort((a,b)=>amount(a.pointsCost)-amount(b.pointsCost))[0]||null;
 return {points,tier,eligible,next,visible:expanded?eligible:eligible.slice(0,3)};
}
export function estimatedPurchasePoints(rules=[],subtotal,currencyCode,now=Date.now()){
 if(!subtotal||!currencyCode||subtotal.currencyCode!==currencyCode||!Number.isFinite(Number(subtotal.amount)))return null;
 let total=0;
 for(const rule of rules.filter(item=>item.type==='PURCHASE'&&item.enabled!==false)){
  const c=rule.conditions||{},start=c.startsAt?Date.parse(c.startsAt):0,end=c.endsAt?Date.parse(c.endsAt):0;
  if((start&&now<start)||(end&&now>end)||amount(subtotal.amount)<amount(c.minimumOrderAmount))continue;
  if(c.firstOrderOnly||amount(c.maxAwardsPerCustomer)>0||['customerTags','productIds','collectionIds'].some(key=>Array.isArray(c[key])&&c[key].length))return null;
  total+=Math.max(0,Math.floor((amount(subtotal.amount)*amount(rule.pointsPerDollar)+amount(rule.points))*amount(rule.multiplier||1)));
 }
 return total;
}
export const usableReservation=(reservation,now=Date.now())=>reservation?.status==='RESERVED'&&Boolean(reservation.discountCode)&&(!reservation.expiresAt||Date.parse(reservation.expiresAt)>now);
