import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { extractHtml } from "../lib/encyclopedia/extract";
import { FACTORY_RESEARCH_FETCH, factoryResearchPlanSchema } from "../lib/encyclopedia/factory-research";
import { fetchSource } from "../lib/encyclopedia/fetcher";
import { sourceText } from "../lib/encyclopedia/source-text";
import { findTrustedSourceDomain, trustedSourceMetadata } from "../lib/encyclopedia/trusted-source-domains";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

/*
 * Turns a topic list into a research plan the factory can run unattended.
 *
 * Two things are checked here rather than discovered later at cost: whether
 * the publisher's reuse terms have actually been read (trusted-source-domains)
 * and whether the page survives extraction. Candidate URLs fail often —
 * roughly four in ten in practice, through 404s, 403s, and pages that reduce
 * to navigation furniture — and a source that yields nothing is worse than a
 * missing one, because it appears in the citation list while supporting
 * nothing. Topics left with fewer than two usable sources are dropped, since
 * the evidence floor would stop them anyway.
 */

const USABLE_CHARACTERS = 600;
const MINIMUM_SOURCES = 2;
/* A second source has to carry the topic, not merely exist.
 *
 * The commonest failure by far — 151 of 229 recorded topic failures — is
 * "only 1 source yielded claims": a page long enough to pass extraction but
 * too narrow to say anything about this particular subject. A glossary entry
 * for one term is the classic case; it defines its own term and mentions its
 * neighbour in passing, so pairing two glossary entries starves both. By the
 * time the floor catches it the batch has paid to fetch, chunk and extract
 * everything. Requiring the second source to be substantial stops that before
 * a single extraction call, at the cost of some topics that would have
 * squeaked through. The right companion is a page that discusses the whole
 * area — a fact sheet, an overview — and those run far past this mark. */
const SUPPORTING_CHARACTERS = 2_000;

const topicSpecSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  topicType: z.string().trim().min(1),
  categoryLabel: z.string().trim().min(1),
  sources: z.array(z.object({
    url: z.string().url(),
    title: z.string().trim().min(1),
    notes: z.string().trim().min(1),
  })).min(MINIMUM_SOURCES),
}).strict();

const specFileSchema = z.object({
  version: z.literal(1),
  topics: z.array(topicSpecSchema).min(1),
}).strict();

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function usableSource(source: { url: string; title: string; notes: string }) {
  const trusted = findTrustedSourceDomain(source.url);
  if (!trusted) return { ok: false as const, reason: "publisher terms not reviewed — add it to trusted-source-domains.ts" };
  try {
    const fetched = await fetchSource(source.url, FACTORY_RESEARCH_FETCH);
    const text = sourceText(fetched);
    const characters = text.replace(/\s+/gu, "").length;
    if (characters < USABLE_CHARACTERS) return { ok: false as const, reason: `extracted only ${characters} characters` };
    return {
      ok: true as const,
      characters,
      source: {
        url: source.url,
        title: source.title,
        publisher: trusted.publisher,
        language: "en",
        sourceType: "government",
        reliabilityTier: "official",
        license: trusted.license,
        metadata: trustedSourceMetadata(trusted, source.notes),
      },
    };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message.slice(0, 90) : "fetch failed" };
  }
}

async function main() {
  const specPath = option("spec");
  const outputPath = option("output");
  if (!specPath || !outputPath) {
    throw new Error("Usage: npm run hubpedia:plan -- --spec=topics.json --output=plan.json");
  }
  const spec = specFileSchema.parse(JSON.parse(readFileSync(resolve(specPath), "utf8")));

  const catalogSlugs = new Set(VIEWABLE_SEED_ARTICLES.map((article) => article.slug));
  const topics = [];
  const dropped: Array<{ slug: string; reason: string }> = [];
  for (const topic of spec.topics) {
    /* A slug is an address, so writing one twice does not add an article, it
     * puts two of them behind one URL and lets whichever the catalog reaches
     * first win. Six pairs got in this way — the planets and genetics waves
     * were queued without anyone checking what the catalog already held. The
     * check costs one lookup and belongs before any page is fetched. */
    if (catalogSlugs.has(topic.slug)) {
      dropped.push({ slug: topic.slug, reason: "the catalog already has an article at this slug." });
      continue;
    }
    const checked = await Promise.all(topic.sources.map(usableSource));
    const usable = checked.flatMap((result) => (result.ok ? [result.source] : []));
    const rejected = checked.flatMap((result, index) => (result.ok ? [] : [`${topic.sources[index].url}: ${result.reason}`]));
    if (usable.length < MINIMUM_SOURCES) {
      dropped.push({ slug: topic.slug, reason: `${usable.length} usable source(s); ${rejected.join(" | ")}` });
      continue;
    }
    /* At least one source must be substantial enough to carry the topic on
     * its own; the rest may be short. Two thin pages together are the pairing
     * that fails the evidence floor after everything has been paid for. */
    const sizes = checked.flatMap((result) => (result.ok ? [result.characters] : []));
    if (Math.max(...sizes) < SUPPORTING_CHARACTERS) {
      dropped.push({
        slug: topic.slug,
        reason: `no source reaches ${SUPPORTING_CHARACTERS} characters (largest ${Math.max(...sizes)}); pair a definition page with one that covers the whole area.`,
      });
      continue;
    }
    topics.push({
      slug: topic.slug,
      title: topic.title,
      description: topic.description,
      topicType: topic.topicType,
      categoryLabel: topic.categoryLabel,
      sources: usable,
    });
    if (rejected.length) console.log(JSON.stringify({ slug: topic.slug, keptSources: usable.length, rejected }));
  }

  if (!topics.length) throw new Error("No topic kept enough usable sources; nothing to plan.");
  const plan = factoryResearchPlanSchema.parse({ version: 1, topics });
  const absoluteOutput = resolve(outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    plan: absoluteOutput,
    topics: topics.length,
    sources: topics.reduce((total, topic) => total + topic.sources.length, 0),
    dropped,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Plan build failed.");
  process.exitCode = 1;
});
