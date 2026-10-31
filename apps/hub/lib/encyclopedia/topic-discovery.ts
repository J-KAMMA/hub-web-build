import { z } from "zod";

const evidenceSchema = z.object({
  chunkId: z.string().uuid(),
  quote: z.string().trim().min(1).max(1_000),
}).strict();

const discoveredTopicSchema = z.object({
  canonicalName: z.string().trim().min(1).max(240),
  slug: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(2_000),
  topicType: z.string().trim().min(1).max(80),
  evidence: z.array(evidenceSchema).min(1).max(10),
}).strict();

export const topicDiscoverySchema = z.object({
  topics: z.array(discoveredTopicSchema).max(10),
}).strict();

export const discoveredTopicsSchema = topicDiscoverySchema;

export type DiscoveryChunk = {
  id: string;
  sourceId: string;
  textContent: string;
};

export type ValidatedDiscoveredTopic = z.infer<typeof discoveredTopicSchema> & {
  sourceIds: string[];
};

export function validateDiscoveredTopics(
  input: unknown,
  chunks: readonly DiscoveryChunk[],
  existingSlugs: readonly string[] | ReadonlySet<string>,
  maxResults: number,
): ValidatedDiscoveredTopic[] {
  if (!Number.isFinite(maxResults) || maxResults <= 0) return [];
  const limit = Math.floor(maxResults);
  if (limit === 0) return [];

  const envelope = z.object({ topics: z.array(z.unknown()).max(10) }).strict().safeParse(input);
  if (!envelope.success) return [];

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const excludedSlugs = new Set(existingSlugs);
  const acceptedSlugs = new Set<string>();
  const results: ValidatedDiscoveredTopic[] = [];

  for (const candidate of envelope.data.topics) {
    const parsed = discoveredTopicSchema.safeParse(candidate);
    if (!parsed.success) continue;

    const topic = parsed.data;
    if (excludedSlugs.has(topic.slug) || acceptedSlugs.has(topic.slug)) continue;

    const sourceIds: string[] = [];
    const seenSourceIds = new Set<string>();
    let hasInvalidEvidence = false;

    for (const item of topic.evidence) {
      const chunk = chunkById.get(item.chunkId);
      if (!chunk || !chunk.textContent.includes(item.quote)) {
        hasInvalidEvidence = true;
        break;
      }
      if (!seenSourceIds.has(chunk.sourceId)) {
        seenSourceIds.add(chunk.sourceId);
        sourceIds.push(chunk.sourceId);
      }
    }

    if (hasInvalidEvidence) continue;

    acceptedSlugs.add(topic.slug);
    results.push({ ...topic, sourceIds });
    if (results.length >= limit) break;
  }

  return results;
}
