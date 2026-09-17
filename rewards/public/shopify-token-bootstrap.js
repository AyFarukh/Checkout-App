async function exchangeShopifyOfflineToken(){
  if(!window.shopify?.idToken) throw new Error("Shopify App Bridge ID token API is unavailable");
  const idToken=await window.shopify.idToken();
  const response=await fetch("/api/shopify-token/exchange",{method:"POST",headers:{Authorization:`Bearer ${idToken}`}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.message||data?.error||`Token exchange failed (${response.status})`);
  return data;
}

async function ensureShopifyOfflineToken(){
  let lastError;
  for(let attempt=1;attempt<=2;attempt+=1){
    try{
      const result=await exchangeShopifyOfflineToken();
      console.info("[Rewards Admin] Shopify offline token ready",result.shop||"");
      document.documentElement.dataset.shopifyOfflineToken="ready";
      document.dispatchEvent(new CustomEvent("rewards:shopify-token-ready",{detail:result}));
      return;
    }catch(error){
      lastError=error;
      if(attempt<2) await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
  console.error("[Rewards Admin] Shopify offline token bootstrap failed",lastError?.message||lastError);
  document.documentElement.dataset.shopifyOfflineToken="failed";
  document.dispatchEvent(new CustomEvent("rewards:shopify-token-failed",{detail:{message:lastError?.message||"Shopify authorization failed"}}));
}

ensureShopifyOfflineToken();
