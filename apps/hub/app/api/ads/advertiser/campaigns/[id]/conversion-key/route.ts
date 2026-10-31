import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { advertiserSessionFromRequest } from "@/lib/server/hub-ads-advertiser-session";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hashHubAdConversionKey } from "@/lib/server/hub-ads-conversion";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const originError=requireSameOrigin(request);if(originError)return originError;
  const session=advertiserSessionFromRequest(request);if(!session)return NextResponse.json({error:"unauthorized"},{status:401});
  const campaignId=(await params).id;const database=getHubD1();
  const campaign=await database.prepare("SELECT id FROM hub_ad_campaigns WHERE id=? AND advertiser_ref=?").bind(campaignId,session.advertiserRef).first();
  if(!campaign)return NextResponse.json({error:"not_found"},{status:404});
  const key=randomBytes(32).toString("base64url"),now=Date.now();
  await database.batch([
    database.prepare("UPDATE hub_ad_conversion_keys SET status='revoked',revoked_at=? WHERE campaign_id=? AND status='active'").bind(now,campaignId),
    database.prepare("INSERT INTO hub_ad_conversion_keys(id,campaign_id,key_hash,status,created_at) VALUES(?,?,?,'active',?)")
      .bind(crypto.randomUUID(),campaignId,hashHubAdConversionKey(key),now),
    database.prepare(`INSERT INTO hub_ad_audit_logs(id,actor_key,action,target_type,target_id,after_json,occurred_at)
      VALUES(?,'advertiser','conversion_key.rotated','campaign',?,json_object('keyFingerprint',?),?)`)
      .bind(crypto.randomUUID(),campaignId,createHash("sha256").update(key).digest("hex").slice(0,12),now),
  ]);
  return NextResponse.json({conversionKey:key,warning:"このキーは再表示されません。広告主サーバーの秘密として保存してください。"},{status:201,headers:{"Cache-Control":"no-store"}});
}
