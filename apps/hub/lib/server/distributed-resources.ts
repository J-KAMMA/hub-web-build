import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { HUB_RESOURCE_MANIFEST_TYPE, parseDistributedResourceManifest, type DistributedResourceKind, type DistributedResourceManifest } from "@/lib/distributed-resource-manifest";

type Row = { id:string;canonical_resource_id:string;manifest_url:string;resource_kind:DistributedResourceKind;origin:string;canonical_url:string;title:string;summary:string;language:string|null;published_at:string|null;preview_url:string|null;license:string;cache_policy:DistributedResourceManifest["cachePolicy"];mirror_policy:DistributedResourceManifest["mirrorPolicy"];ai_training_policy:DistributedResourceManifest["aiTraining"];commerce_mode:DistributedResourceManifest["commerceMode"];content_hash:string|null;tags_json:string;capabilities_json:string;mirrors_json:string;metadata_json:string;verification_status:"pending"|"verified"|"restricted"|"rejected";availability_status:"active"|"unavailable"|"removed";fetched_at:string };
export type PublicDistributedResource = DistributedResourceManifest & Pick<Row,"id"|"verification_status"|"availability_status"> & { manifestUrl:string;fetchedAt:string };

const COLUMNS="id,canonical_resource_id,manifest_url,resource_kind,origin,canonical_url,title,summary,language,published_at,preview_url,license,cache_policy,mirror_policy,ai_training_policy,commerce_mode,content_hash,tags_json,capabilities_json,mirrors_json,metadata_json,verification_status,availability_status,fetched_at";
function mapRow(row:Row):PublicDistributedResource {
  const manifest=parseDistributedResourceManifest({type:HUB_RESOURCE_MANIFEST_TYPE,resourceId:row.canonical_resource_id,kind:row.resource_kind,origin:row.origin,canonicalUrl:row.canonical_url,title:row.title,summary:row.summary,language:row.language??undefined,publishedAt:row.published_at??undefined,previewUrl:row.preview_url??undefined,license:row.license,cachePolicy:row.cache_policy,mirrorPolicy:row.mirror_policy,aiTraining:row.ai_training_policy,commerceMode:row.commerce_mode,contentHash:row.content_hash??undefined,tags:JSON.parse(row.tags_json),capabilities:JSON.parse(row.capabilities_json),mirrors:JSON.parse(row.mirrors_json),metadata:JSON.parse(row.metadata_json)});
  return {...manifest,id:row.id,manifestUrl:row.manifest_url,verification_status:row.verification_status,availability_status:row.availability_status,fetchedAt:row.fetched_at};
}

export async function listDistributedResources(db:D1Database,input:{kind?:DistributedResourceKind;limit?:number;offset?:number;includePending?:boolean}={}) {
  const conditions=["availability_status='active'",input.includePending?"verification_status IN ('pending','verified')":"verification_status='verified'"];
  const bindings:unknown[]=[];
  if(input.kind){conditions.push("resource_kind=?");bindings.push(input.kind);}
  bindings.push(Math.min(50,Math.max(1,input.limit??30)),Math.max(0,input.offset??0));
  const result=await db.prepare(`SELECT ${COLUMNS} FROM distributed_resource_manifests WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(published_at,created_at) DESC LIMIT ? OFFSET ?`).bind(...bindings).all<Row>();
  return result.results.map(mapRow);
}

export async function saveDistributedResource(db:D1Database,viewer:Pick<Profile,"id">,manifestUrl:string,manifest:DistributedResourceManifest,now=new Date()) {
  const id=crypto.randomUUID(),timestamp=now.toISOString();
  await db.prepare(`INSERT INTO distributed_resource_manifests(id,canonical_resource_id,manifest_url,resource_kind,origin,canonical_url,title,summary,language,published_at,preview_url,license,cache_policy,mirror_policy,ai_training_policy,commerce_mode,content_hash,tags_json,capabilities_json,mirrors_json,metadata_json,submitted_by_profile_id,verification_status,availability_status,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','active',?,?,?)`).bind(id,manifest.resourceId,manifestUrl,manifest.kind,manifest.origin,manifest.canonicalUrl,manifest.title,manifest.summary,manifest.language??null,manifest.publishedAt??null,manifest.previewUrl??null,manifest.license,manifest.cachePolicy,manifest.mirrorPolicy,manifest.aiTraining,manifest.commerceMode,manifest.contentHash??null,JSON.stringify(manifest.tags),JSON.stringify(manifest.capabilities),JSON.stringify(manifest.mirrors),JSON.stringify(manifest.metadata),viewer.id,timestamp,timestamp,timestamp).run();
  return {...manifest,id,manifestUrl,verification_status:"pending" as const,availability_status:"active" as const,fetchedAt:timestamp};
}

export type DistributedPreferenceKind=DistributedResourceKind;
export async function getDistributedPreferences(db:D1Database,profileId:string){
  const result=await db.prepare("SELECT provider_kind,provider_resource_id,mode,updated_at FROM distributed_provider_preferences WHERE profile_id=? ORDER BY provider_kind").bind(profileId).all<{provider_kind:DistributedPreferenceKind;provider_resource_id:string|null;mode:"hub-standard"|"local"|"external";updated_at:string}>();
  return result.results.map(row=>({kind:row.provider_kind,providerResourceId:row.provider_resource_id,mode:row.mode,updatedAt:row.updated_at}));
}
export async function putDistributedPreference(db:D1Database,profileId:string,input:{kind:DistributedPreferenceKind;mode:"hub-standard"|"local"|"external";providerResourceId?:string|null},now=new Date()){
  const providerId=input.mode==="external"?input.providerResourceId??null:null;
  if(input.mode==="external"){
    const expected=input.kind;
    const row=await db.prepare("SELECT resource_kind,verification_status,availability_status FROM distributed_resource_manifests WHERE id=?").bind(providerId).first<{resource_kind:string;verification_status:string;availability_status:string}>();
    if(!row||row.resource_kind!==expected||row.verification_status!=="verified"||row.availability_status!=="active")throw new Error("provider_unavailable");
  }
  const updatedAt=now.toISOString();
  await db.prepare("INSERT INTO distributed_provider_preferences(profile_id,provider_kind,provider_resource_id,mode,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,provider_kind) DO UPDATE SET provider_resource_id=excluded.provider_resource_id,mode=excluded.mode,updated_at=excluded.updated_at").bind(profileId,input.kind,providerId,input.mode,updatedAt).run();
  return {kind:input.kind,mode:input.mode,providerResourceId:providerId,updatedAt};
}
