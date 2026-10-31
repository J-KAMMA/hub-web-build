import { discoverActivityPub } from "@/lib/server/activitypub-discovery";

export type ActivityPubRecommendation = {
  id: string;
  url: string;
  content: string;
  published?: string;
  sourceHost: string;
  actor: { name: string; handle: string; url: string };
};

export async function getActivityPubRecommendations(
  sources: string[],
  fetcher: typeof fetch = fetch,
): Promise<ActivityPubRecommendation[]> {
  const settled = await Promise.allSettled(
    [...new Set(sources)].slice(0, 8).map((source) => discoverActivityPub(source, fetcher)),
  );
  const seen = new Set<string>();
  return settled.flatMap((result) => {
    if (result.status !== "fulfilled" || !result.value.actor) return [];
    const actor = result.value.actor;
    return result.value.posts.flatMap((post) => {
      if (seen.has(post.id)) return [];
      seen.add(post.id);
      return [{
        ...post,
        sourceHost: new URL(actor.id).hostname,
        actor: { name: actor.name, handle: actor.handle, url: actor.url },
      }];
    });
  }).sort((left, right) => {
    const leftTime = left.published ? Date.parse(left.published) : 0;
    const rightTime = right.published ? Date.parse(right.published) : 0;
    return rightTime - leftTime;
  }).slice(0, 16);
}
