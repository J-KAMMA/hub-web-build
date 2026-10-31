import { clampListOffset } from "@/lib/server/list-pagination";
import { NextResponse } from "next/server";
import { DISTRIBUTED_RESOURCE_KINDS, InvalidDistributedResourceManifestError, normalizeDistributedPublicUrl, parseDistributedResourceManifest, type DistributedResourceKind } from "@/lib/distributed-resource-manifest";
import { listDistributedResources, saveDistributedResource } from "@/lib/server/distributed-resources";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";
import { isRedirectResponse } from "@/lib/redirect-guard";

const MAX_BYTES=128*1024;
async function fetchManifest(url:string){
  const response=await fetch(url,{headers:{accept:"application/ld+json, application/json"},redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok||isRedirectResponse(response))throw new InvalidDistributedResourceManifestError("配信元のマニフェストを取得できませんでした。");
  const length=Number(response.headers.get("content-length")??0);
  if(length>MAX_BYTES)throw new InvalidDistributedResourceManifestError("マニフェストが大きすぎます。");
  const text=await response.text();
  if(new TextEncoder().encode(text).byteLength>MAX_BYTES)throw new InvalidDistributedResourceManifestError("マニフェストが大きすぎます。");
  try{return parseDistributedResourceManifest(JSON.parse(text));}catch(error){if(error instanceof InvalidDistributedResourceManifestError)throw error;throw new InvalidDistributedResourceManifestError("マニフェストを解析できませんでした。");}
}
export async function GET(request:Request){
  const url=new URL(request.url),rawKind=url.searchParams.get("kind");
  const kind=rawKind&&DISTRIBUTED_RESOURCE_KINDS.includes(rawKind as DistributedResourceKind)?rawKind as DistributedResourceKind:undefined;
  const limit=Math.min(50,Math.max(1,Number(url.searchParams.get("limit")??30)||30));
  const offset=clampListOffset(Number(url.searchParams.get("offset")??0)||0);
  const resources=await listDistributedResources(getHubD1(),{kind,limit,offset});
  return NextResponse.json({resources,limit,offset},{headers:publicApiCacheHeaders(request,"distributed.resources")});
}
export async function POST(request:Request){
  if(!hasSameOrigin(request))return NextResponse.json({error:"invalid_origin"},{status:403});
  try{
    const body=await request.json().catch(()=>null) as {manifestUrl?:unknown}|null;
    const manifestUrl=normalizeDistributedPublicUrl(body?.manifestUrl,"manifestUrl"),db=getHubD1(),viewer=await requireHubSessionProfile(request,db),manifest=await fetchManifest(manifestUrl),resource=await saveDistributedResource(db,viewer,manifestUrl,manifest);
    return NextResponse.json({resource,message:"確認待ちとして登録しました。公開前に配信元と内容を検証します。"},{status:201});
  }catch(error){
    if(error instanceof HubAuthenticationError)return NextResponse.json({error:"authentication_required"},{status:401});
    if(error instanceof InvalidDistributedResourceManifestError)return NextResponse.json({error:error.message},{status:400});
    if(error instanceof Error&&/unique/i.test(error.message))return NextResponse.json({error:"already_registered"},{status:409});
    return NextResponse.json({error:"resource_registration_failed"},{status:500});
  }
}
