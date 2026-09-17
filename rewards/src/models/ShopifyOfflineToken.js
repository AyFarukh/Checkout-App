import mongoose from "mongoose";
const schema=new mongoose.Schema({shop:{type:String,required:true,unique:true,index:true},accessToken:{type:String,required:true},refreshToken:{type:String,default:null},accessTokenExpiresAt:{type:Date,default:null},refreshTokenExpiresAt:{type:Date,default:null},scope:{type:String,default:""},acquiredAt:{type:Date,default:Date.now},refreshedAt:{type:Date,default:null}},{timestamps:true});
export const ShopifyOfflineToken=mongoose.models.ShopifyOfflineToken||mongoose.model("ShopifyOfflineToken",schema);
