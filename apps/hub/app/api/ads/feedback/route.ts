import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hashHubAdFrequencyBucket, verifyHubAdMeasurementToken } from "@/lib/server/hub-ads-token";
import { parseHubAdFeedbackAction, recordHubAdFeedback } from "@/lib/server/hub-ads-feedback";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const FREQUENCY_COOKIE = "hub.ads.frequency";
function frequencyCookie(request: Request) {
  const value=(request.headers.get("cookie")??"").split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${FREQUENCY_COOKIE}=`))?.slice(FREQUENCY_COOKIE.length+1);
  return value && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const originError=requireSameOrigin(request); if(originError)return originError;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const payload=typeof body?.token==="string"?verifyHubAdMeasurementToken(body.token):null;
  const action=parseHubAdFeedbackAction(body?.action); const raw=frequencyCookie(request);
  const frequencyBucketHash=raw?hashHubAdFrequencyBucket(raw):null;
  if(!payload||!action||!frequencyBucketHash)return NextResponse.json({error:"invalid_feedback"},{status:400});
  const accepted=await recordHubAdFeedback(getHubD1(),{tokenId:payload.tokenId,lineItemId:payload.lineItemId,
    creativeVersionId:payload.creativeVersionId,frequencyBucketHash,action,now:Date.now()});
  if(accepted){const now=Date.now();await getHubD1().prepare(`INSERT INTO hub_ad_experience_daily(report_day,placement_id,hidden_count,updated_at) VALUES(date(?/1000,'unixepoch'),?,1,?) ON CONFLICT(report_day,placement_id) DO UPDATE SET hidden_count=hidden_count+1,updated_at=excluded.updated_at`).bind(now,payload.placementId,now).run();}
  return NextResponse.json({accepted},{status:accepted?202:200,headers:{"Cache-Control":"no-store"}});
}
