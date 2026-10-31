import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

type Attribution = { campaignId: string; lineItemId: string; creativeVersionId: string; nonce: string; issuedAt: number; expiresAt: number };
const ID = /^[0-9a-f-]{36}$/i;
function secret() { const value = process.env.HUB_ADS_CONVERSION_SECRET; return value && value.length >= 32 ? value : null; }
function signature(encoded: string, key: string) { return createHmac("sha256", key).update(`hub-ads-conversion-v1.${encoded}`).digest("base64url"); }
export const hashHubAdConversionKey = (value: string) => createHash("sha256").update(`hub-ads-conversion-key-v1\0${value}`).digest("base64url");

export function createHubAdAttributionToken(input: Omit<Attribution,"nonce"|"issuedAt"|"expiresAt">, now=Date.now()) {
  const key=secret(); if(!key || !ID.test(input.campaignId)||!ID.test(input.lineItemId)||!ID.test(input.creativeVersionId)) return null;
  const payload:Attribution={...input,nonce:crypto.randomUUID(),issuedAt:now,expiresAt:now+7*86_400_000};
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${encoded}.${signature(encoded,key)}`;
}
export function verifyHubAdAttributionToken(token:string,now=Date.now()):Attribution|null {
  const key=secret();const[e,s,x]=token.split(".");if(!key||!e||!s||x)return null;
  const a=Buffer.from(s),b=Buffer.from(signature(e,key));if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  try{const p=JSON.parse(Buffer.from(e,"base64url").toString("utf8")) as Attribution;
    return ID.test(p.campaignId)&&ID.test(p.lineItemId)&&ID.test(p.creativeVersionId)&&ID.test(p.nonce)
      &&Number.isInteger(p.issuedAt)&&Number.isInteger(p.expiresAt)&&now>=p.issuedAt-60_000&&now<p.expiresAt&&p.expiresAt-p.issuedAt===7*86_400_000?p:null;
  }catch{return null;}
}
export async function recordHubAdConversion(database:D1Database,attribution:Attribution,type:string,value:number|null,keyHash:string,now=Date.now()){
  if(!["lead","signup","purchase","qualified_visit"].includes(type)||value!==null&&(!Number.isSafeInteger(value)||value<0))return false;
  const authorized=await database.prepare(`SELECT 1 ok FROM hub_ad_conversion_keys k JOIN hub_ad_campaigns c ON c.id=k.campaign_id
    WHERE k.key_hash=? AND k.status='active' AND k.campaign_id=? AND c.status!='archived'`).bind(keyHash,attribution.campaignId).first();if(!authorized)return false;
  const result=await database.prepare(`INSERT OR IGNORE INTO hub_ad_conversion_events
    (id,conversion_key_hash,campaign_id,line_item_id,creative_version_id,conversion_type,value_jpy_micros,occurred_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),hashHubAdConversionKey(attribution.nonce),attribution.campaignId,attribution.lineItemId,
      attribution.creativeVersionId,type,value,now,now).run();return(result.meta.changes??0)>0;
}
