(() => {
 'use strict';
 const api='/apps/ftr-welcome/rewards/api',content=document.getElementById('rewards-content'),status=document.getElementById('rewards-status');
 let data,busy=false,confirmation='',latest;
 const pending=new Map();
 const tiers=[{name:'Seedling',min:0,icon:'🌿'},{name:'Sprout',min:500,icon:'🌱'},{name:'Rooted',min:1500,icon:'🌲'},{name:'Canopy',min:3000,icon:'👑'}];
 const fmt=value=>Number(value||0).toLocaleString();
 function el(tag,text,cls){const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node;}
 function add(parent,...nodes){nodes.filter(Boolean).forEach(node=>parent.append(node));return parent;}
 function button(label,action){const node=el('button',label);node.type='button';node.disabled=busy;node.addEventListener('click',action);return node;}
 function section(title,id){const node=el('section',null,'rewards-section');if(id)node.id=id;node.append(el('h2',title));return node;}
 async function request(path,body,key){const response=await fetch(api+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})}:{},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(result.error?.message||result.error||'Rewards are unavailable. Please try again.');error.status=response.status;throw error;}return result;}
 async function copy(value){try{await navigator.clipboard.writeText(value);status.textContent='Copied to clipboard.';}catch{status.textContent='Copy the code displayed on this page.';}}
 function codeCard(item){return add(el('article',null,'reward-item'),el('h3',item.discountCode),item.expiresAt?el('p','Expires '+new Date(item.expiresAt).toLocaleDateString(),'fine'):null,button('Copy code',()=>copy(item.discountCode)));}
 async function redeem(reward){if(busy)return;busy=true;render();status.textContent='Creating your reward…';
  if(!pending.has(reward._id))pending.set(reward._id,'storefront:'+crypto.randomUUID());
  try{const result=await request('/redemptions/reserve',{rewardId:reward._id},pending.get(reward._id));const reservation=result.redemption;
   if(reservation?.status!=='RESERVED'||!reservation.discountCode){
    if(['RELEASED','CANCELLED','COMMITTED','REFUNDED'].includes(reservation?.status))pending.delete(reward._id);
    throw new Error(reservation?.status==='RESERVED'?'Your reward is still being prepared. Please try again shortly.':'The previous reward attempt is no longer available. Please try again.');
   }
   latest=reservation;pending.delete(reward._id);confirmation='';data=await request('/me');status.textContent='Your reward is ready. Copy the code below.';}
  catch(error){status.textContent=error.message;}finally{busy=false;render();}
 }
 function render(){
  content.replaceChildren();const customer=data.customer||{},points=Number(customer.pointsBalance||0),lifetime=Number(customer.lifetimeEarned||0),tier=tiers.reduce((current,item)=>lifetime>=item.min?item:current,tiers[0]),next=tiers[tiers.indexOf(tier)+1];
  const account=section('YOUR ACCOUNT','your-account'),balance=el('div',null,'balance-card');
  add(balance,el('p','YOUR ROOT REWARDS BALANCE','balance-label'),el('h3','Hi '+(String(customer.firstName||'').trim()||'friend')+' 👋'),el('p',fmt(points)+' POINTS','balance-points'),add(el('div',null,'balance-meta'),el('span',tier.icon+' '+tier.name+' Member','member-pill'),el('span','Available to redeem')),
   Number(customer.pointsReserved)>0?el('p',fmt(customer.pointsReserved)+' points reserved for rewards','fine'):null);account.append(balance);content.append(account);
  if(latest?.discountCode){const ready=section('Your reward is ready');ready.append(codeCard(latest));content.append(ready);}
  const journey=section('Your membership journey'),track=el('progress');track.max=next?next.min-tier.min:1;track.value=next?Math.max(0,Math.min(track.max,lifetime-tier.min)):1;track.setAttribute('aria-label',next?'Progress toward '+next.name:'Highest tier reached');
  add(journey,el('p',fmt(lifetime)+' lifetime points · '+tier.name),track,el('p',next?fmt(Math.max(0,next.min-lifetime))+' more points to '+next.name:'You have reached Canopy.','fine'));const tierList=el('ul',null,'tier-list');tiers.forEach(item=>tierList.append(add(el('li',null,item===tier?'current-tier':''),el('span',item.icon+' '+item.name),el('small',item.min?fmt(item.min)+' lifetime points':'Start growing'))));journey.append(tierList);content.append(journey);
  const earn=section('Ways to earn points'),rules=(data.rules||[]).filter(rule=>!['MANUAL','BONUS'].includes(rule.type)&&(Number(rule.points)>0||Number(rule.pointsPerDollar)>0));
  if(!rules.length)earn.append(el('p','More ways to earn will appear here when enabled.','fine'));
  rules.forEach(rule=>earn.append(add(el('div',null,'earning-row'),el('span',rule.name),el('strong',rule.pointsPerDollar?fmt(rule.pointsPerDollar)+' pt / $1':fmt(rule.points)+' points'))));content.append(earn);
  const rewards=section('Redeem your points','redeem');
  if(!(data.rewards||[]).length)rewards.append(el('p','Rewards will appear here when available.','fine'));
  (data.rewards||[]).forEach(reward=>{const enough=points>=Number(reward.pointsCost),synced=reward.shopifySync?.status==='SYNCED',item=add(el('article',null,'reward-item'),el('h3',reward.name),el('p',fmt(reward.pointsCost)+' points','reward-cost'));
   if(confirmation===reward._id){const confirm=add(el('div',null,'confirm-reward'),el('p','Redeem '+fmt(reward.pointsCost)+' points? These points will be reserved until the reward is used or released.'));add(confirm,button('Confirm redemption',()=>redeem(reward)),button('Cancel',()=>{confirmation='';render();}));item.append(confirm);}
   else{const action=button(!synced?'Coming soon':enough?'Redeem reward':fmt(Math.max(0,Number(reward.pointsCost)-points))+' more points needed',()=>{confirmation=reward._id;render();});action.disabled=busy||!synced||!enough;item.append(action);}rewards.append(item);
  });content.append(rewards);
  const active=(data.redemptions||[]).filter(item=>item.status==='RESERVED'&&item.discountCode);if(active.length){const sectionNode=section('Active rewards');active.forEach(item=>sectionNode.append(codeCard(item)));content.append(sectionNode);}
  const activity=section('Recent activity'),list=el('ul',null,'activity-list');(data.activity||[]).slice(0,8).forEach(item=>list.append(add(el('li'),add(el('div'),el('span',item.reason||item.source||item.type),el('small',new Date(item.createdAt).toLocaleDateString())),el('strong',(item.points>0?'+':'')+fmt(item.points)+' pts'))));activity.append(list);if(!list.children.length)activity.append(el('p','Your points activity will appear here.','fine'));content.append(activity);
 }
 function guest(){content.replaceChildren();const box=section('Sign in to your rewards'),login=el('a','Sign in','button');login.href='/account/login?return_url='+encodeURIComponent(location.pathname+location.search);add(box,el('p','Sign in to see your points, redeem rewards, and invite friends.'),login);content.append(box);document.getElementById('refer').hidden=true;}
 request('/me').then(result=>{data=result;status.textContent='';render();}).catch(error=>{if(error.status===401){status.textContent='';guest();}else{status.textContent=error.message;content.append(button('Try again',()=>location.reload()));}});
})();
