import { storedOfflineTokenForShop } from "./shopify-token.service.js";

const API_VERSION=process.env.SHOPIFY_ADMIN_API_VERSION||"2026-07";
const REWARDS_FUNCTION_TITLE="FreeTheRoots Rewards Discount";
const FUNCTION_CACHE_TTL_MS=5*60*1000;
const functionCache=new Map();

function normalizedShop(shop){
  const value=String(shop||"").trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value))throw Object.assign(new Error("Invalid Shopify shop domain"),{permanent:true,code:"SHOPIFY_SHOP_INVALID"});
  return value;
}

async function tokenForShop(shop){
  const domain=normalizedShop(shop),stored=await storedOfflineTokenForShop(domain);
  if(stored)return stored;
  const map=process.env.SHOPIFY_OFFLINE_TOKENS_JSON;
  if(map){
    let parsed;
    try{parsed=JSON.parse(map)}catch{throw Object.assign(new Error("SHOPIFY_OFFLINE_TOKENS_JSON is invalid JSON"),{permanent:true,code:"SHOPIFY_OFFLINE_TOKENS_INVALID"})}
    const token=parsed?.[domain];
    if(typeof token==="string"&&token.trim())return token.trim();
  }
  const fallback=String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||"").trim();
  if(fallback)return fallback;
  throw Object.assign(new Error(`No stored Shopify offline token for ${domain}. Open the embedded app to authorize background sync.`),{permanent:true,code:"SHOPIFY_OFFLINE_TOKEN_MISSING"});
}

async function adminGraphql(shop,query,variables={},apiVersion=API_VERSION){
  const domain=normalizedShop(shop),token=await tokenForShop(domain);
  let response;
  try{
    response=await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token},
      body:JSON.stringify({query,variables})
    });
  }catch(error){
    throw Object.assign(new Error(`Shopify Admin API network failure: ${error.message}`),{code:"SHOPIFY_NETWORK_ERROR",retryable:true});
  }
  const json=await response.json().catch(()=>({}));
  if(!response.ok){
    const retryable=response.status===429||response.status>=500;
    throw Object.assign(new Error(`Shopify Admin API HTTP ${response.status}`),{code:`SHOPIFY_HTTP_${response.status}`,retryable,permanent:!retryable});
  }
  if(json.errors?.length)throw Object.assign(new Error(json.errors.map(e=>e.message).join("; ")),{code:"SHOPIFY_GRAPHQL_ERROR",retryable:true});
  return json.data;
}

async function configuredFunctionExists(shop,functionId){
  if(!functionId)return false;
  try{
    const data=await adminGraphql(shop,`query RewardsFunction($id: String!) { shopifyFunction(id: $id) { id title apiType } }`,{id:functionId});
    return data?.shopifyFunction?.id===functionId;
  }catch(error){
    console.warn("[Rewards Shopify] configured function validation failed; attempting discovery",{shop:normalizedShop(shop),message:error.message});
    return false;
  }
}

async function discoverRewardsFunctionId(shop){
  const domain=normalizedShop(shop);
  const cached=functionCache.get(domain);
  if(cached&&cached.expiresAt>Date.now())return cached.functionId;

  // Shopify currently exposes the installed API client's function collection through
  // the unstable Admin schema. We only use it as discovery/failover; discount creation
  // itself remains on the configured stable Admin API version.
  const data=await adminGraphql(domain,`query RewardsFunctions { shopifyFunctions(first: 100) { nodes { id title apiType } } }`,{},"unstable");
  const nodes=data?.shopifyFunctions?.nodes||[];
  const matches=nodes.filter(node=>String(node?.title||"").trim()===REWARDS_FUNCTION_TITLE);
  if(matches.length!==1){
    throw Object.assign(
      new Error(matches.length
        ? `Multiple Shopify Functions named "${REWARDS_FUNCTION_TITLE}" are installed for ${domain}; cannot select one safely.`
        : `Shopify Function "${REWARDS_FUNCTION_TITLE}" is not installed/released for ${domain}.`),
      {permanent:true,code:matches.length?"SHOPIFY_REWARDS_FUNCTION_AMBIGUOUS":"SHOPIFY_REWARDS_FUNCTION_NOT_FOUND"}
    );
  }
  const functionId=String(matches[0].id||"").trim();
  if(!functionId)throw Object.assign(new Error("Discovered rewards Shopify Function has no ID"),{permanent:true,code:"SHOPIFY_REWARDS_FUNCTION_ID_MISSING"});
  functionCache.set(domain,{functionId,expiresAt:Date.now()+FUNCTION_CACHE_TTL_MS});
  console.info("[Rewards Shopify] resolved rewards Function",{shop:domain,functionId,title:REWARDS_FUNCTION_TITLE});
  return functionId;
}

export async function resolveRewardsFunctionId(shop){
  const domain=normalizedShop(shop);
  const configured=String(process.env.SHOPIFY_REWARDS_FUNCTION_ID||"").trim();
  if(configured&&await configuredFunctionExists(domain,configured)){
    functionCache.set(domain,{functionId:configured,expiresAt:Date.now()+FUNCTION_CACHE_TTL_MS});
    return configured;
  }
  return discoverRewardsFunctionId(domain);
}

export async function validateShopifyAdminConfiguration(shop){
  const domain=normalizedShop(shop),token=await tokenForShop(domain),functionId=await resolveRewardsFunctionId(domain);
  return{shop:domain,apiVersion:API_VERSION,tokenConfigured:Boolean(token),functionId};
}

export async function shopifyAdminGraphql(shop,query,variables={}){
  return adminGraphql(shop,query,variables,API_VERSION);
}

export function assertNoUserErrors(payload){
  const errors=payload?.userErrors||[];
  if(errors.length)throw Object.assign(new Error(errors.map(e=>e.message).join("; ")),{code:"SHOPIFY_USER_ERROR",permanent:true,details:errors});
  return payload;
}
