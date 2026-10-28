import {createElement as h} from 'preact';
import {useCallback,useEffect,useState} from 'preact/hooks';

const text=(value,props={})=>h('s-text',props,value);
const stack=(...children)=>h('s-stack',{gap:'base',direction:'block'},...children);
const heading=value=>h('s-heading',null,value);
const icon=(type,props={})=>h('s-icon',{type,...props});
const card=(children,props={})=>h('s-box',{padding:'large',border:'base',borderRadius:'large',background:'base',...props},children);
const grid=(columns,...children)=>h('s-grid',{gridTemplateColumns:columns,gap:'base',alignItems:'center'},...children);

export default function ReferralSection({apiBase}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[code,setCode]=useState(''),[claimed,setClaimed]=useState(null),[showFriend,setShowFriend]=useState(false);
  const request=useCallback(async(path='',body)=>{
    const token=await shopify.sessionToken.get();
    const response=await fetch(`${apiBase}/api/customer/referrals${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(typeof result.error==='string'?result.error:result.error?.message||'Referrals are unavailable. Please try again.');
    return result;
  },[apiBase]);
  const load=useCallback(async()=>{if(!apiBase)return;try{setError('');setData(await request());}catch(e){setError(e.message);}},[request,apiBase]);
  useEffect(()=>{load();},[load]);
  async function claim(path,body,key){
    if(busy)return;
    setBusy(key);setError('');setNotice('');
    try{const result=await request(path,body);setClaimed(result);setData(await request());setNotice('Your discount code is ready.');}
    catch(e){setError(e.message);}finally{setBusy('');}
  }
  async function copy(value){try{await navigator.clipboard.writeText(value);setNotice('Copied to clipboard.');}catch{setNotice('Copy the link or code shown above.');}}
  const button=(label,onClick,props={})=>h('s-button',{onClick,disabled:Boolean(busy),...props},label);
  function money(value){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:data?.program?.currencyCode||'USD',currencyDisplay:'narrowSymbol',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));}catch{return String(value||0);}}
  function offer(value){
    if(value.status==='QUALIFIED'||value.status==='REVOKED'||(value.expiresAt&&new Date(value.expiresAt)<=new Date()))return text('This offer has been used or has expired.',{color:'subdued'});
    return stack(text('Your code: '+value.discountCode,{type:'strong'}),
      value.expiresAt?text('Expires '+new Date(value.expiresAt).toLocaleDateString(),{color:'subdued'}):null,
      button('Copy code',()=>copy(value.discountCode),{variant:'primary'}),
      value.minimumSpend?text('Minimum merchandise subtotal before discount: '+money(value.minimumSpend),{color:'subdued'}):null,
      value.productUrl?h('s-link',{href:value.productUrl},'View gift product'):null);
  }
  if(!apiBase)return null;
  if(!data)return h('s-section',{heading:'Refer & Earn'},stack(error?h('s-banner',{tone:'critical'},error):text('Loading referrals…'),error?button('Try again',load):h('s-spinner')));
  if(!data.enabled)return h('s-section',{heading:'Refer & Earn'},text('Referrals are not available right now.'));

  const program=data.program||{},count=Number(data.qualifiedCount||0),milestones=[...(data.milestones||[])].sort((a,b)=>Number(a.threshold)-Number(b.threshold));
  const next=milestones.find(m=>Number(m.threshold)>count),goal=next?.threshold||Math.max(1,...milestones.map(m=>Number(m.threshold)||0));
  const message=`Enjoy ${money(program.friendDiscountAmount)} off your first order at FreeTheRoots: ${data.shareUrl||''}`;
  async function invite(){
    if(typeof navigator.share==='function'){
      try{await navigator.share({title:'FreeTheRoots',text:message,url:data.shareUrl});}
      catch(e){if(e.name!=='AbortError')await copy(data.shareUrl);}
    }else await copy(data.shareUrl);
  }
  let referralPage='';try{const page=new URL(data.shareUrl);page.search='';referralPage=page.href;}catch{}

  function milestoneRow(m){
    const label=m.kind==='REFERRAL_POINTS'?`${Number(program.referrerPoints||0)} points`:m.title;
    const state=['CONSUMED','REFUNDED'].includes(m.status)?'Claimed':m.status==='EXPIRED'?'Expired':m.unlocked?'Unlocked':'';
    const description=m.kind==='POINTS'?`${Number(m.points||0)} bonus pts`:m.kind==='PRODUCT'&&
      (Number(m.quantity||1)>1||(m.productTitle&&!String(m.title).toLowerCase().includes(String(m.productTitle).toLowerCase())))?`${Number(m.quantity||1)} × ${m.productTitle||'gift'}`:null;
    const marker=h('s-box',{inlineSize:'36px',blockSize:'36px',borderRadius:'max',background:'subdued'},
      h('s-stack',{alignItems:'center',justifyContent:'center',inlineSize:'100%',blockSize:'100%'},
        m.unlocked?icon('check',{tone:'success'}):text(String(m.threshold),{type:'strong',color:'subdued'})));
    const labels=stack(text(`${m.threshold} ${Number(m.threshold)===1?'referral':'referrals'} — ${label}`),description?text(description,{type:'small',color:'subdued'}):null);
    const action=m.unlocked&&m.kind==='PRODUCT'&&!m.discountCode&&['AVAILABLE','ISSUED'].includes(m.status)
      ?button('Claim gift',()=>claim('/milestones/'+encodeURIComponent(m.id)+'/claim',{},String(m.id)),{variant:'primary',loading:busy===String(m.id)}):null;
    return h('s-stack',{key:m.id,accessibilityRole:'list-item',direction:'block',gap:'small',paddingBlock:'small'},
      grid('36px minmax(0, 1fr) auto',marker,labels,
        h('s-stack',{direction:'block',gap:'small',alignItems:'end'},state?text(state,{tone:m.unlocked?'success':'auto',type:'small'}):null,action)),
      m.discountCode?h('s-box',{padding:'base',background:'subdued',borderRadius:'base'},offer(m)):null);
  }
  const shareTile=(label,type,onClick,href)=>h('s-button',{
    ...(href?{href}:{onClick}),disabled:Boolean(busy),variant:'primary',inlineSize:'fill',accessibilityLabel:`Share referral link: ${label}`,
  },icon(type),label);

  return h('s-box',{inlineSize:'100%',maxInlineSize:'624px'},
    h('s-stack',{direction:'block',gap:'large'},
      error?h('s-banner',{tone:'critical'},error):null,
      notice?h('s-banner',{tone:'success'},notice):null,
      stack(text('INVITE FRIENDS',{tone:'success',type:'strong'}),heading('Refer & Earn')),
      card(h('s-stack',{direction:'block',gap:'large',alignItems:'center'},
        h('s-box',{padding:'base',borderRadius:'max',background:'base'},icon('profile',{size:'large-100',tone:'success'})),
        heading(`Give ${money(program.friendDiscountAmount)}, Get ${Number(program.referrerPoints||0)} pts`),
        h('s-paragraph',null,`Share FreeTheRoots with friends. They get ${money(program.friendDiscountAmount)} off their first order, you earn ${Number(program.referrerPoints||0)} points when they buy.`)),{background:'subdued'}),
      card(stack(text('YOUR UNIQUE LINK',{color:'subdued',type:'strong'}),
        data.shareUrl?grid('minmax(0, 1fr) auto',
          h('s-box',{padding:'base',background:'subdued',borderRadius:'large',overflow:'hidden'},text(data.shareUrl)),
          button('Copy',()=>copy(data.shareUrl),{variant:'primary',accessibilityLabel:'Copy referral link'})):null,
        data.code?grid('minmax(0, 1fr) auto',text('Code: '+data.code,{type:'small',color:'subdued'}),
          button('Copy code',()=>copy(data.code),{variant:'primary'})):null,
        data.shareUrl?grid('repeat(3, minmax(0, 1fr))',shareTile('Text','mobile',null,'sms:?body='+encodeURIComponent(message)),
          shareTile('Email','email',null,'mailto:?subject='+encodeURIComponent('A gift from FreeTheRoots')+'&body='+encodeURIComponent(message)),
          shareTile('More','arrow-up-right',invite)):null)),
      card(stack(
        grid('minmax(0, 1fr) auto',grid('auto minmax(0, 1fr)',icon('gift-card',{tone:'success'}),heading('Referral progress')),text(`${count}/${goal}`,{tone:'success',type:'strong'})),
        count<=0?h('s-divider'):h('s-progress',{max:Number(goal),value:Math.max(0,Math.min(count,Number(goal))),
          // Preact skips value=0 when the custom element already reports its default zero.
          // An explicit attribute is required to keep Shopify out of indeterminate mode.
          ref:element=>{if(element)element.setAttribute('value',String(Math.max(0,Math.min(count,Number(goal)))));},accessibilityLabel:`${count} of ${goal} successful referrals`}),
        next?h('s-paragraph',null,text(`${Number(next.threshold)-count} more ${Number(next.threshold)-count===1?'friend':'friends'} to unlock `,{color:'subdued'}),text(next.title,{type:'strong'}),text('.'))
          :text('You have unlocked every milestone.',{tone:'success'}),
        h('s-stack',{direction:'block',gap:'small',accessibilityRole:'unordered-list',accessibilityLabel:'Referral milestones'},...milestones.map(milestoneRow)),
        Number(data.referralDebt)>0?text('Some referral points are being adjusted following a returned or canceled order.',{type:'small',color:'subdued'}):null)),
      data.shareUrl?button('Invite friends now',invite,{variant:'primary',inlineSize:'fill'}):null,
      referralPage?h('s-link',{href:referralPage},'View the fully styled referral page'):null,
      button(showFriend?'Hide friend offer':'Have a referral code?',()=>setShowFriend(!showFriend),{variant:'primary',inlineSize:'fill'}),
      showFriend?card(stack(heading('Claim your friend offer'),text('Claim before placing your first order. Eligibility and expiry apply.',{color:'subdued'}),
        data.friendOffer?.discountCode?offer(data.friendOffer):stack(
          h('s-text-field',{label:'Referral code',value:code,onInput:event=>setCode(event.currentTarget.value)}),
          button('Claim friend offer',()=>{if(!code.trim()){setError('Enter a referral code first.');return;}claim('/claim',{code:code.trim()},'friend');},{variant:'primary',loading:busy==='friend',inlineSize:'fill'})))):null,
      claimed?.discountCode?card(stack(heading(claimed.productTitle||'Your offer is ready'),offer(claimed))):null));
}
