import {createElement as h} from 'preact';
import {useCallback,useEffect,useState} from 'preact/hooks';
const text=value=>h('s-text',null,value);
const stack=(...children)=>h('s-stack',{gap:'base',direction:'block'},...children);
const row=(...children)=>h('s-stack',{gap:'base',direction:'inline'},...children);
const box=(...children)=>h('s-box',{padding:'base',border:'base',borderRadius:'base'},stack(...children));
export default function ReferralSection({apiBase}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[code,setCode]=useState(''),[claimed,setClaimed]=useState(null);
 const request=useCallback(async(path='',body)=>{const token=await shopify.sessionToken.get();const response=await fetch(`${apiBase}/api/customer/referrals${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof result.error==='string'?result.error:result.error?.message||'Referrals are unavailable. Please try again.');return result;},[apiBase]);
 const load=useCallback(async()=>{if(!apiBase)return;try{setError('');setData(await request());}catch(e){setError(e.message);}},[request,apiBase]);
 useEffect(()=>{load();},[load]);
 async function claim(path,body,key){if(busy)return;setBusy(key);setError('');setNotice('');try{const result=await request(path,body);setClaimed(result);setData(await request());setNotice('Your discount code is ready.');}catch(e){setError(e.message);}finally{setBusy('');}}
 async function copy(value){try{await navigator.clipboard.writeText(value);setNotice('Copied to clipboard.');}catch{setNotice('Copy the link or code shown above.');}}
 const button=(label,onClick,props={})=>h('s-button',{onClick,disabled:Boolean(busy),...props},label);
 const offer=value=>(value.status==='QUALIFIED'||value.status==='REVOKED'||(value.expiresAt&&new Date(value.expiresAt)<=new Date()))?text('This offer has been used or has expired.'):stack(text('Your code: '+value.discountCode),value.expiresAt?text('Expires '+new Date(value.expiresAt).toLocaleDateString()):null,button('Copy code',()=>copy(value.discountCode)),value.minimumSpend?text('Minimum merchandise subtotal before discount: '+value.minimumSpend+' '+(data?.program?.currencyCode||'')):null,value.productUrl?h('s-link',{href:value.productUrl},'View gift product'):null);
 if(!apiBase)return null;
 if(!data)return h('s-section',{heading:'REFER A FRIEND'},stack(error?h('s-banner',{tone:'critical'},error):text('Loading referrals…'),error?button('Try again',load):h('s-spinner')));
 if(!data.enabled)return h('s-section',{heading:'REFER A FRIEND'},text('Referrals are not available right now.'));
 const program=data.program||{},count=Number(data.qualifiedCount||0),milestones=data.milestones||[],next=milestones.find(m=>Number(m.threshold)>count),max=next?.threshold||Math.max(1,...milestones.map(m=>Number(m.threshold)||0));
 let discount;try{discount=new Intl.NumberFormat(undefined,{style:'currency',currency:program.currencyCode||'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(program.friendDiscountAmount||0));}catch{discount=String(program.friendDiscountAmount||0);}
 const message=`Enjoy ${discount} off your first order at FreeTheRoots: ${data.shareUrl||''}`;
 return h('s-section',{heading:'REFER A FRIEND'},stack(
 error?h('s-banner',{tone:'critical'},error):null,notice?h('s-banner',{tone:'success'},notice):null,
 box(h('s-heading',null,`Give ${discount}, Get ${Number(program.referrerPoints||0)} pts`),text('Share the roots. Give a friend a first-order offer and earn points when their qualifying order is complete.'),
 data.shareUrl?stack(text(data.shareUrl),row(button('Copy link',()=>copy(data.shareUrl),{variant:'primary'}),h('s-link',{href:'sms:?body='+encodeURIComponent(message)},'Text'),h('s-link',{href:'mailto:?subject='+encodeURIComponent('A gift from FreeTheRoots')+'&body='+encodeURIComponent(message)},'Email'),button('More',async()=>{if(typeof navigator.share==='function'){try{await navigator.share({title:'FreeTheRoots',text:message,url:data.shareUrl});}catch(e){if(e.name!=='AbortError')await copy(data.shareUrl);}}else await copy(data.shareUrl);}))) : null,
 data.code?stack(text('Your referral code: '+data.code),button('Copy referral code',()=>copy(data.code))):null),
 box(h('s-heading',null,'Your referral journey'),text(`${count} qualifying ${count===1?'referral':'referrals'}`),text(`${Math.min(count,max)} / ${max} referrals toward your next milestone`),
 ...milestones.map(m=>box(h('s-heading',null,m.title),h('s-badge',{tone:m.unlocked?'success':'neutral'},m.unlocked?'Unlocked':`${m.threshold} referrals`),text(m.kind!=='PRODUCT'?`${m.kind==='REFERRAL_POINTS'?Number(program.referrerPoints||0):m.points} points`:`${m.quantity||1} × ${m.productTitle||'gift'}`),m.discountCode?offer(m):m.unlocked&&m.kind==='PRODUCT'&&['AVAILABLE','ISSUED'].includes(m.status)?button('Claim gift',()=>claim('/milestones/'+encodeURIComponent(m.id)+'/claim',{},String(m.id)),{loading:busy===String(m.id),variant:'primary'}):text(m.status||(m.unlocked?'Reward earned':'Keep sharing to unlock')))),
 Number(data.referralDebt)>0?text('Some referral points are being adjusted following a returned or canceled order.'):null),
 box(h('s-heading',null,'Have a referral code?'),text('Claim your friend offer before placing your first order. Eligibility and expiry apply.'),data.friendOffer?.discountCode?offer(data.friendOffer):stack(h('s-text-field',{label:'Referral code',value:code,onInput:event=>setCode(event.currentTarget.value)}),button('Claim friend offer',()=>{if(!code.trim()){setError('Enter a referral code first.');return;}claim('/claim',{code:code.trim()},'friend');},{loading:busy==='friend',variant:'primary'}))),
 claimed?.discountCode?box(h('s-heading',null,claimed.productTitle||'Your offer is ready'),offer(claimed)):null));
}
