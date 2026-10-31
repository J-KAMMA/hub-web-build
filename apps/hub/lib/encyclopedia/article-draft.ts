import { z } from "zod";

export const articleDraftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(2000),
  reading: z.string().trim().max(500).default(""),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  categoryIds: z.array(z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/)).min(1).max(4).default(["knowledge"]),
  relatedSlugs: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(10).default([]),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(300),
    paragraphs: z.array(z.object({
      text: z.string().trim().min(1).max(5000),
      citationIndexes: z.array(z.number().int().positive()).min(1).max(20),
      links: z.array(z.object({
        anchor: z.string().trim().min(1).max(200),
        targetSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      }).strict()).max(20).default([])
    })).min(1).max(12)
  })).min(1).max(20)
}).strict();

export type ArticleDraft = z.infer<typeof articleDraftSchema>;

function escapeInlineMarkdown(value: string) {
  return value.replace(/([\\[\]*_`])/g, "\\$1");
}

function linkParagraph(
  text: string,
  links: ArticleDraft["sections"][number]["paragraphs"][number]["links"],
  allowedTargets: ReadonlyMap<string, string>,
  linkedTargets: Set<string>
) {
  const placements = links
    .filter((link) => allowedTargets.has(link.targetSlug) && !linkedTargets.has(link.targetSlug))
    .map((link) => ({ ...link, start: text.indexOf(link.anchor) }))
    .filter((link) => link.start >= 0)
    .sort((a, b) => a.start - b.start || b.anchor.length - a.anchor.length);
  const accepted: typeof placements = [];
  let end = 0;
  for (const placement of placements) {
    if (placement.start < end || linkedTargets.has(placement.targetSlug)) continue;
    accepted.push(placement);
    linkedTargets.add(placement.targetSlug);
    end = placement.start + placement.anchor.length;
  }
  if (!accepted.length) return escapeInlineMarkdown(text);
  let cursor = 0;
  let output = "";
  for (const placement of accepted) {
    output += escapeInlineMarkdown(text.slice(cursor, placement.start));
    output += `[${escapeInlineMarkdown(placement.anchor)}](/hubpedia/${placement.targetSlug})`;
    cursor = placement.start + placement.anchor.length;
  }
  return output + escapeInlineMarkdown(text.slice(cursor));
}

export function renderArticleMarkdown(draft: ArticleDraft, claimCount: number, allowedTargets: ReadonlyMap<string, string> = new Map()) {
  const used = new Set<number>();
  const linkedTargets = new Set<string>();
  const sections = draft.sections.map((section) => {
    const paragraphs = section.paragraphs.map((paragraph) => {
      const citations = [...new Set(paragraph.citationIndexes)]
        .filter((index) => index <= claimCount)
        .sort((a, b) => a - b);
      if (!citations.length) throw new Error("Every generated paragraph must cite at least one known claim.");
      citations.forEach((index) => used.add(index));
      return `${linkParagraph(paragraph.text, paragraph.links, allowedTargets, linkedTargets)} ${citations.map((index) => `[${index}]`).join("")}`;
    });
    return `## ${section.heading}\n\n${paragraphs.join("\n\n")}`;
  });
  const related = [...new Set(draft.relatedSlugs)]
    .filter((slug) => allowedTargets.has(slug) && !linkedTargets.has(slug))
    .slice(0, 8)
    .map((slug) => `- [${escapeInlineMarkdown(allowedTargets.get(slug) ?? slug)}](/hubpedia/${slug})`);
  if (related.length) sections.push(`## 関連記事\n\n${related.join("\n")}`);
  return { bodyMarkdown: sections.join("\n\n"), citationIndexes: [...used].sort((a, b) => a - b) };
}
