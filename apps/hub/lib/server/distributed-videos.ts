import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { parseDistributedVideoManifest, type DistributedVideoManifest } from "@/lib/distributed-video-manifest";

export type PublicDistributedVideo = DistributedVideoManifest & { id: string; manifestUrl: string; fetchedAt: string };

type Row = { id:string;canonical_video_id:string;manifest_url:string;origin:string;title:string;description:string;channel:string;category:string;language:string|null;published_at:string|null;thumbnail_url:string|null;license:string;cache_policy:DistributedVideoManifest["cachePolicy"];ai_training_policy:DistributedVideoManifest["aiTraining"];embed_allowed:number;age_rating:DistributedVideoManifest["ageRating"];content_hash:string|null;streams_json:string;captions_json:string;mirrors_json:string;tags_json:string;fetched_at:string };

function mapRow(row: Row): DistributedVideoManifest {
  return parseDistributedVideoManifest({ type:"https://hub.jkamma.com/spec/video-manifest/v1", videoId:row.canonical_video_id, origin:row.origin, title:row.title, description:row.description, channel:row.channel, category:row.category, language:row.language ?? undefined, publishedAt:row.published_at ?? undefined, thumbnailUrl:row.thumbnail_url ?? undefined, license:row.license, cachePolicy:row.cache_policy, aiTraining:row.ai_training_policy, embedAllowed:Boolean(row.embed_allowed), ageRating:row.age_rating, contentHash:row.content_hash ?? undefined, streams:JSON.parse(row.streams_json), captions:JSON.parse(row.captions_json), mirrors:JSON.parse(row.mirrors_json), tags:JSON.parse(row.tags_json) });
}

const COLUMNS = "id,canonical_video_id,manifest_url,origin,title,description,channel,category,language,published_at,thumbnail_url,license,cache_policy,ai_training_policy,embed_allowed,age_rating,content_hash,streams_json,captions_json,mirrors_json,tags_json,fetched_at";

export async function listDistributedVideos(db:D1Database, limit=30, offset=0) {
  const result=await db.prepare(`SELECT ${COLUMNS} FROM distributed_video_manifests WHERE status='active' ORDER BY COALESCE(published_at,created_at) DESC LIMIT ? OFFSET ?`).bind(Math.min(50,Math.max(1,limit)),Math.max(0,offset)).all<Row>();
  return result.results.map((row)=>({ ...mapRow(row), id:row.id, manifestUrl:row.manifest_url, fetchedAt:row.fetched_at }));
}

export async function saveDistributedVideo(db:D1Database, viewer:Pick<Profile,"id">, manifestUrl:string, manifest:DistributedVideoManifest, now=new Date()) {
  const id=crypto.randomUUID(), timestamp=now.toISOString();
  await db.prepare(`INSERT INTO distributed_video_manifests(id,canonical_video_id,manifest_url,origin,title,description,channel,category,language,published_at,thumbnail_url,license,cache_policy,ai_training_policy,embed_allowed,age_rating,content_hash,streams_json,captions_json,mirrors_json,tags_json,submitted_by_profile_id,status,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`).bind(id,manifest.videoId,manifestUrl,manifest.origin,manifest.title,manifest.description,manifest.channel,manifest.category,manifest.language??null,manifest.publishedAt??null,manifest.thumbnailUrl??null,manifest.license,manifest.cachePolicy,manifest.aiTraining,manifest.embedAllowed?1:0,manifest.ageRating,manifest.contentHash??null,JSON.stringify(manifest.streams),JSON.stringify(manifest.captions),JSON.stringify(manifest.mirrors),JSON.stringify(manifest.tags),viewer.id,timestamp,timestamp,timestamp).run();
  return { ...manifest,id,manifestUrl,fetchedAt:timestamp };
}
