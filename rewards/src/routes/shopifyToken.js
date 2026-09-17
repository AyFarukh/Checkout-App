import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { exchangeOfflineToken } from "../services/shopify-token.service.js";
export const shopifyToken=Router();shopifyToken.use(adminAuth);shopifyToken.post("/exchange",async(req,res,next)=>{try{const idToken=String(req.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim(),shop=String(req.shopifySession?.shop||"").trim().toLowerCase();if(!idToken||!shop)return res.status(401).json({error:"Authenticated Shopify ID token required"});res.json({ok:true,...await exchangeOfflineToken({shop,idToken})})}catch(error){next(error)}});
