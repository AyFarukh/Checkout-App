(() => {
  'use strict';
  const api = '/apps/ftr-welcome/referrals', content = document.getElementById('content'), status = document.getElementById('status');
  const incoming = new URLSearchParams(location.search).get('ref') || '';
  let data, busy = false, manualCode = incoming, friendExpanded = Boolean(incoming);
  function el(tag, text, cls) { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node; }
  function add(parent, ...nodes) { nodes.filter(Boolean).forEach(node => parent.append(node)); return parent; }
  function button(label, action, secondary = false) { const node = el('button', label, secondary ? 'secondary' : ''); node.type = 'button'; node.disabled = busy; node.addEventListener('click', action); return node; }
  function card(title) { return add(el('section', null, 'card'), el('h2', title)); }
  function money(amount) { try { return new Intl.NumberFormat(undefined, {style:'currency', currency:data.program.currencyCode || 'USD', currencyDisplay:'narrowSymbol', minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(amount || 0)); } catch { return String(amount || 0); } }
  async function request(path, body) { const response = await fetch(api + path, {method: body ? 'POST' : 'GET', credentials:'same-origin', headers:body ? {'Content-Type':'application/json'} : {}, ...(body ? {body:JSON.stringify(body)} : {})}); const result = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Unable to load referrals. Please try again.'); error.status = response.status; throw error; } return result; }
  async function copy(value) { try { await navigator.clipboard.writeText(value); status.textContent = 'Copied to clipboard.'; } catch { status.textContent = 'Copy the link or code displayed on this page.'; } }
  function offer(parent, value) {
    if (value.status === 'QUALIFIED' || value.status === 'REVOKED' || (value.expiresAt && new Date(value.expiresAt) <= new Date())) { parent.append(el('p','This offer has been used or has expired.','fine')); return; }
    add(parent, el('p', value.discountCode, 'code'), value.expiresAt ? el('p', 'Expires ' + new Date(value.expiresAt).toLocaleDateString(), 'fine') : null, button('Copy code', () => copy(value.discountCode), true));
    if(value.minimumSpend) parent.append(el('p','Minimum merchandise subtotal before discount: '+money(value.minimumSpend),'fine'));
    const match=String(value.variantId||'').match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/);
    if(match && Number.isInteger(value.quantity) && value.quantity>=1 && value.quantity<=10) parent.append(button('Add gift to cart',async()=>{
      if(busy)return; busy=true; renderButtons(); status.textContent='Adding your gift…';
      try { const response=await fetch('/cart/add.js',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{id:match[1],quantity:value.quantity}]})});
        if(!response.ok)throw new Error('The gift could not be added. Check availability or contact the store.');
        location.href='/discount/'+encodeURIComponent(value.discountCode)+'?redirect=/cart';
      } catch(error){status.textContent=error.message;} finally{busy=false;renderButtons();}
    }));
  }
  async function claim(path, body) { if (busy) return; busy = true; render(); status.textContent = 'Claiming your offer…'; try { const result = await request(path, body); data = await request('/me'); render(); status.textContent = 'Your discount code is ready.'; const resultCard = card(result.productTitle || 'Your offer is ready'); resultCard.classList.add('offer-result'); offer(resultCard, result); content.prepend(resultCard); } catch (error) { status.textContent = error.message; } finally { busy = false; renderButtons(); } }
  function renderButtons() { content.querySelectorAll('button').forEach(node => { node.disabled = busy; }); }
  function icon(name) {
    const paths={people:'<path d="M16 21c4 0 7-3 7-7s-3-7-7-7-7 3-7 7 3 7 7 7Z"/><path d="M4 38v-3c0-5 5-9 12-9s12 4 12 9v3M28 8c4 0 6 3 6 6s-2 6-5 6M34 27c4 1 6 4 6 8v3"/>',copy:'<rect x="9" y="9" width="14" height="17" rx="2"/><path d="M18 5H6a2 2 0 0 0-2 2v14"/>',gift:'<rect x="4" y="12" width="24" height="7" rx="2"/><path d="M7 19v13h18V19M16 12v20M16 12H9a4 4 0 1 1 4-6l3 6Zm0 0h7a4 4 0 1 0-4-6l-3 6Z"/>',check:'<path d="m5 12 5 5L21 6"/>',arrow:'<path d="m9 5 7 7-7 7"/>',text:'<path d="M25 12c0 6-5 10-11 10h-3l-6 4 1-7c-2-2-3-4-3-7C3 6 8 2 14 2s11 4 11 10Z"/><path d="M9 12h.1M14 12h.1M19 12h.1"/>',email:'<rect x="2" y="5" width="25" height="19" rx="2"/><path d="m3 6 11.5 10L26 6"/>',more:'<rect x="3" y="3" width="24" height="24" rx="5"/><path d="M10 20 21 9M12 9h9v9"/>'};
    const node=document.createElementNS('http://www.w3.org/2000/svg','svg');
    node.setAttribute('viewBox',name==='people'?'0 0 44 44':name==='gift'?'0 0 34 36':name==='copy'?'0 0 28 30':name==='check'||name==='arrow'?'0 0 24 24':'0 0 30 30');
    node.setAttribute('fill','none');node.setAttribute('stroke','currentColor');node.setAttribute('stroke-width','2');node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');node.setAttribute('aria-hidden','true');node.innerHTML=paths[name]||'';return node;
  }
  async function invite() {
    if(!data?.shareUrl)return;
    const message=`Enjoy ${money(data.program.friendDiscountAmount)} off your first order at FreeTheRoots: ${data.shareUrl}`;
    if(navigator.share){try{await navigator.share({title:'FreeTheRoots',text:message,url:data.shareUrl});}catch(error){if(error.name!=='AbortError')await copy(data.shareUrl);}}
    else await copy(data.shareUrl);
  }
  function render() {
    content.replaceChildren();
    const heading=add(el('header',null,'page-heading'),el('p','INVITE FRIENDS','eyebrow'),el('h1','Refer & Earn'));content.append(heading);
    if (!data.enabled) { add(content,card('Referrals are not available right now')); return; }
    const program=data.program||{},count=Number(data.qualifiedCount||0),milestones=[...(data.milestones||[])].sort((a,b)=>Number(a.threshold)-Number(b.threshold));
    const hero=el('section',null,'hero');
    add(hero,add(el('div',null,'offer-icon'),icon('people')),el('h2',`Give ${money(program.friendDiscountAmount)}, Get ${Number(program.referrerPoints||0)} pts`),el('p',`Share FreeTheRoots with friends. They get ${money(program.friendDiscountAmount)} off their first order, you earn ${Number(program.referrerPoints||0)} points when they buy.`));content.append(hero);
    const share=el('section',null,'card share-card');share.setAttribute('aria-label','Share your referral link');share.append(el('h2','YOUR UNIQUE LINK','share-label'));
    if(data.shareUrl){
      const link=el('code',data.shareUrl);link.title=data.shareUrl;
      const copyButton=button('',()=>copy(data.shareUrl));copyButton.classList.add('copy-link');copyButton.setAttribute('aria-label','Copy referral link');add(copyButton,icon('copy'),el('span','Copy'));
      add(share,add(el('div',null,'shareline'),link,copyButton));
    }
    if(data.code){const codeButton=button(data.code,()=>copy(data.code));codeButton.className='code-value';codeButton.setAttribute('aria-label','Copy referral code');share.append(add(el('p',null,'code-line'),el('span','Code: '),codeButton));}
    if(data.shareUrl){
      const message=`Enjoy ${money(program.friendDiscountAmount)} off your first order at FreeTheRoots: ${data.shareUrl}`,actions=el('div',null,'share-actions');
      const text=add(el('a',null,'button share-action'),icon('text'),el('span','Text'));text.href='sms:?body='+encodeURIComponent(message);text.setAttribute('aria-label','Share referral link by text');
      const email=add(el('a',null,'button share-action'),icon('email'),el('span','Email'));email.href='mailto:?subject='+encodeURIComponent('A little gift from FreeTheRoots')+'&body='+encodeURIComponent(message);email.setAttribute('aria-label','Share referral link by email');
      const more=button('',invite);more.className='share-action';add(more,icon('more'),el('span','More'));add(actions,text,email,more);share.append(actions);
    }
    content.append(share);
    const next=milestones.find(m=>Number(m.threshold)>count),max=next?.threshold||Math.max(1,...milestones.map(m=>Number(m.threshold)||0));
    const journey=el('section',null,'card progress-card');
    add(journey,add(el('div',null,'progress-heading'),add(el('div',null,'progress-title'),icon('gift'),el('h2','Referral progress')),el('span',`${count}/${max}`,'progress-count')));
    const progress=el('progress');progress.max=max;progress.value=Math.min(count,max);progress.setAttribute('aria-label',`${count} of ${max} successful referrals`);journey.append(progress);
    const progressCopy=el('p',null,'progress-copy');
    if(next)add(progressCopy,el('span',`${Math.max(0,Number(next.threshold)-count)} more ${Number(next.threshold)-count===1?'friend':'friends'} to unlock `),el('strong',next.title),el('span','.'));
    else progressCopy.textContent='You have unlocked every milestone. Keep sharing the roots!';journey.append(progressCopy);
    const list=el('ul',null,'milestones');
    milestones.forEach(m=>{
      const item=el('li',null,'milestone'),marker=el('span',m.unlocked?null:m.threshold,'milestone-marker'+(m.unlocked?' unlocked':''));
      if(m.unlocked)marker.append(icon('check'));
      const label=m.kind==='REFERRAL_POINTS'?`${Number(program.referrerPoints||0)} points`:m.title;
      const right=el('div',null,'milestone-right');
      if(m.unlocked)right.append(el('span',['CONSUMED','REFUNDED'].includes(m.status)?'Claimed':m.status==='EXPIRED'?'Expired':'Unlocked','milestone-state'));
      if(!m.discountCode&&m.unlocked&&m.kind==='PRODUCT'&&['AVAILABLE','ISSUED'].includes(m.status)){
        const claimButton=button('Claim gift',()=>claim('/milestones/'+encodeURIComponent(m.id)+'/claim',{}));claimButton.className='milestone-action';claimButton.setAttribute('aria-label','Claim '+m.title);right.append(claimButton);
      }
      const labelNode=el('span',`${m.threshold} ${Number(m.threshold)===1?'referral':'referrals'} — ${label}`,'milestone-label');
      if(m.kind==='POINTS')labelNode.append(el('small',`${Number(m.points||0)} bonus pts`,'milestone-description'));
      if(m.kind==='PRODUCT'&&(Number(m.quantity||1)>1||(m.productTitle&&!String(m.title).toLowerCase().includes(String(m.productTitle).toLowerCase()))))labelNode.append(el('small',`${Number(m.quantity||1)} × ${m.productTitle||'gift'}`,'milestone-description'));
      add(item,add(el('div',null,'milestone-row'),marker,labelNode,right));
      if(m.discountCode){const details=el('div',null,'milestone-offer');offer(details,m);item.append(details);}list.append(item);
    });journey.append(list);
    if(Number(data.referralDebt)>0)journey.append(el('p','Some referral points are being adjusted following a returned or canceled order.','fine debt-note'));content.append(journey);
    if(data.shareUrl){const inviteButton=button('',invite);inviteButton.className='invite-cta';add(inviteButton,el('span','Invite friends now'),icon('arrow'));content.append(inviteButton);}
    const friend=el('details',null,'card friend-card');friend.open=friendExpanded||Boolean(data.friendOffer);friend.addEventListener('toggle',()=>{friendExpanded=friend.open;});
    add(friend,el('summary','Have a referral code?'),el('p','Claim your friend offer before placing your first order. Eligibility and expiry apply.','friend-help'));
    if(data.friendOffer?.discountCode)offer(friend,data.friendOffer);
    else{const label=el('label','Referral code'),input=el('input');input.id='friend-code';input.value=manualCode;input.addEventListener('input',()=>{manualCode=input.value;});input.autocomplete='off';input.maxLength=100;label.htmlFor=input.id;
      add(friend,label,input,button('Claim friend offer',()=>{const code=input.value.trim();if(!code){status.textContent='Enter a referral code first.';input.focus();return;}claim('/claim',{code});}));}
    content.append(friend);
  }
  function guest() { content.replaceChildren(); const box=card('Sign in to grow your rewards'); box.classList.add('guest-card'); add(box,el('p','Sign in to view your unique referral link and claim a friend offer.')); const login=el('a','Sign in','button'); login.href='/account/login?return_url='+encodeURIComponent(location.pathname+location.search); box.append(login); if(incoming) add(box,el('p','Your referral code: '+incoming,'code'),button('Copy referral code',()=>copy(incoming),true)); add(box,el('p','If sign-in does not return you here, reopen this referral link after signing in.','fine'),button('Copy this link',()=>copy(location.href),true)); content.append(box); }
  request('/me').then(result=>{data=result;status.textContent='';render();}).catch(error=>{ if(error.status===401){status.textContent='';guest();}else{status.textContent=error.message;content.append(button('Try again',()=>location.reload()));} });
})();
