import { z } from "zod";

const translationInfoboxRowSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(500),
  cite: z.number().int().positive().optional(),
}).strict();

export const translationResponseSchema = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(2_000),
  bodyMarkdown: z.string().min(1).max(100_000),
  /* Localized infobox rows ride the translation so the EN page can show the
   * same fact table; verifyFactoryDrafts checks JA/EN parity separately. */
  infobox: z.array(translationInfoboxRowSchema).min(1).max(12).optional(),
}).strict();

export type TranslationResponse = z.infer<typeof translationResponseSchema>;

function countMatches(value: string, pattern: RegExp): Map<string, number> {
  const counts = new Map<string, number>();

  for (const match of value.matchAll(pattern)) {
    const marker = match[1];
    counts.set(marker, (counts.get(marker) ?? 0) + 1);
  }

  return counts;
}

function multisetsEqual(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>) {
  if (left.size !== right.size) return false;

  for (const [value, count] of left) {
    if (right.get(value) !== count) return false;
  }

  return true;
}

function citationMarkers(markdown: string) {
  return countMatches(markdown, /\[(\d+)\]/g);
}

function internalLinkTargets(markdown: string) {
  return countMatches(markdown, /\]\(\s*(\/hubpedia\/[a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:"[^"]*")?\)/g);
}

export function validateTranslation(sourceMarkdown: string, input: unknown): TranslationResponse {
  const parsed = translationResponseSchema.parse(input);

  if (!multisetsEqual(citationMarkers(sourceMarkdown), citationMarkers(parsed.bodyMarkdown))) {
    throw new Error("Translation must preserve every citation marker exactly.");
  }

  if (!multisetsEqual(internalLinkTargets(sourceMarkdown), internalLinkTargets(parsed.bodyMarkdown))) {
    throw new Error("Translation must preserve every internal link target exactly.");
  }

  return parsed;
}
