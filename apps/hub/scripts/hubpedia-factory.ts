import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { auditCatalog } from "../lib/encyclopedia/catalog-audit";
import { extractHtml } from "../lib/encyclopedia/extract";
import {
  assembleFactoryDrafts,
  buildFactoryTranslationJobs,
  collectFactoryCandidates,
  planFactoryExpandJobs,
  planFactoryTranslationJobs,
  unwrapUnresolvableInternalLinks,
  verifyFactoryDrafts,
  verifyFactoryDraftsToFixedPoint,
  type FactoryJobFile,
  type FactoryQualityDraft,
} from "../lib/encyclopedia/factory";
import {
  FACTORY_RESEARCH_CHUNKING,
  FACTORY_RESEARCH_FETCH,
  assembleFactorySourcedRecord,
  assessEvidenceSufficiency,
  auditFactorySourcedRecord,
  chunkResearchText,
  claimJobTopicSlug,
  collectResearchCandidates,
  factoryResearchChunkSchema,
  factoryResearchPlanSchema,
  factorySourcedRecordSchema,
  gateResearchPlan,
  planFactoryClaimJobs,
  planSharedFactoryClaimJobs,
  sharedClaimJobPageIndex,
  planFactorySourcedArticleJob,
  verifyFactoryClaims,
  type FactoryClaimsResponse,
  type FactoryResearchChunk,
  type FactorySourcedRecord,
} from "../lib/encyclopedia/factory-research";
import { fetchSource } from "../lib/encyclopedia/fetcher";
import { sourceText } from "../lib/encyclopedia/source-text";
import { runUnsourcedMode } from "./hubpedia-unsourced-mode";
import type { HubTopicMaterial } from "../lib/server/hubpedia-hub-topic-draft";
import { openLocalHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";
import { buildRelatedSlugIndex } from "../lib/encyclopedia/structure-engine";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

/*
 * One-command Hubpedia production line built from parts that already exist:
 *
 *   plan      backlog from the live catalog audit (short ja articles to
 *             expand, audited ja articles missing English)
 *   generate  scripts/run-hubpedia-ai-jobs.ts (resume, rate limit, retries)
 *   assemble  candidate JSONL -> bilingual reader-quality drafts; expanded
 *             articles are re-translated from their NEW Japanese text
 *   verify    the same checks audit-hubpedia-quality-batches enforces, plus
 *             the article quality engine; failures never leave the run dir
 *   package   lib/encyclopedia/seed/reader-quality-factory-<batch>.bilingual.json,
 *             registered via generate-hubpedia-quality-manifest and re-audited
 *             by the independent audit script as the final gate
 *
 * Publication stays human-gated: packaging feeds the reader-quality layer
 * only. Nothing here touches publication-manifest.ts.
 */

const USAGE = `Usage: tsx scripts/hubpedia-factory.ts [--batch=name] [--limit=N] [--min-chars=N] [--mode=full|expand|translate|research|unsourced|hub-topics] [--candidate=id[,id]] [--plan=research-plan.json] [--provider=api|claude|codex] [--api-provider=deepseek|opencode-go] [--extract-provider=api|claude|codex] [--codex-model=name] [--codex-concurrency=N] [--model=opus] [--extract-model=sonnet] [--api-model=name] [--extract-api-model=name] [--concurrency=N] [--dry-run] [--skip-generate] [--no-package]`;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const batch = option("batch") ?? new Date().toISOString().slice(0, 10);
if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(batch)) throw new Error(`--batch must be lowercase letters, digits, and hyphens. ${USAGE}`);
const limitRaw = option("limit");
const limit = limitRaw === undefined ? 25 : Number(limitRaw);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error(`--limit must be 1 to 1000. ${USAGE}`);
const minimumCharacters = Number(option("min-chars") ?? "800");
if (!Number.isSafeInteger(minimumCharacters) || minimumCharacters < 0) throw new Error(`--min-chars must be a non-negative integer. ${USAGE}`);
const mode = option("mode") ?? "full";
if (mode !== "full" && mode !== "expand" && mode !== "translate" && mode !== "research" && mode !== "unsourced" && mode !== "hub-topics") throw new Error(USAGE);
const dryRun = process.argv.includes("--dry-run");
const skipGenerate = process.argv.includes("--skip-generate");
const noPackage = process.argv.includes("--no-package");
/* Two generators, same job files and same candidate JSONL: an
 * OpenAI-compatible API key, or the logged-in Claude CLI subscription. */
const provider = option("provider") ?? "api";
if (provider !== "api" && provider !== "claude" && provider !== "codex") throw new Error(`--provider must be api, claude or codex. ${USAGE}`);
/* Extraction may run somewhere else entirely, and it is the one stage where
 * that is safe. Every claim it returns has to quote its chunk verbatim or
 * verification drops it, so a weaker model cannot put a falsehood into an
 * article — it can only return fewer claims, and too few stops the topic at
 * the evidence floor. Writing has no such check: the merge articles came back
 * shorter than the halves they replaced when the writing model was lowered,
 * and nothing in the pipeline noticed. So the provider is per stage. */
const extractProvider = option("extract-provider") ?? provider;
if (extractProvider !== "api" && extractProvider !== "claude" && extractProvider !== "codex") throw new Error(`--extract-provider must be api, claude or codex. ${USAGE}`);
/* Which OpenAI-compatible endpoint the api provider talks to: the default
 * (deepseek / env) or opencode-go, which carries a local daily cap. */
const apiProvider = option("api-provider");
if (apiProvider !== undefined && apiProvider !== "deepseek" && apiProvider !== "opencode-go" && apiProvider !== "chain") throw new Error(`--api-provider must be deepseek, opencode-go or chain. ${USAGE}`);
const codexModel = option("codex-model");
const codexConcurrency = Number(option("codex-concurrency") ?? "2");
if (!Number.isSafeInteger(codexConcurrency) || codexConcurrency < 1 || codexConcurrency > 8) {
  throw new Error(`--codex-concurrency must be an integer from 1 to 8. ${USAGE}`);
}
const apiModel = option("api-model");
const apiExtractModel = option("extract-api-model") ?? apiModel;
const claudeModel = option("model") ?? "opus";
if (!/^[a-z0-9.-]+$/.test(claudeModel)) throw new Error(`--model must be a plain model name such as opus or sonnet. ${USAGE}`);
/* Model per stage, not per run. Pulling quotes out of a page and restating
 * them is mechanical work; deciding what an article says is not. --model
 * sets the writing model and --extract-model the mechanical one, so a batch
 * does not pay top-tier rates for copying. */
const claudeExtractModel = option("extract-model") ?? "sonnet";
if (!/^[a-z0-9.-]+$/.test(claudeExtractModel)) throw new Error(`--extract-model must be a plain model name such as sonnet or haiku. ${USAGE}`);
const claudeConcurrency = Number(option("concurrency") ?? "3");
if (!Number.isSafeInteger(claudeConcurrency) || claudeConcurrency < 1 || claudeConcurrency > 16) {
  throw new Error(`--concurrency must be an integer from 1 to 16. ${USAGE}`);
}

const runDir = join(hubDir, "data", "factory", batch);
mkdirSync(runDir, { recursive: true });

function writeJobFile(name: string, file: FactoryJobFile) {
  const path = join(runDir, name);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return path;
}

function runScript(relativeScript: string, args: string[], label: string) {
  const result = relativeScript.endsWith(".mjs")
    ? spawnSync(process.execPath, [relativeScript, ...args], { cwd: hubDir, stdio: "inherit" })
    : spawnSync(process.execPath, [require.resolve("tsx/cli"), relativeScript, ...args], { cwd: hubDir, stdio: "inherit" });
  if (result.error) throw result.error;
  return { label, exitCode: result.status ?? 1 };
}

type GenerateStage = "extract" | "write";

function generate(jobsPath: string, outputPath: string, jobCount: number, extraArgs: string[] = [], stage: GenerateStage = "write") {
  if (jobCount === 0 || skipGenerate) return { label: "generate", exitCode: 0 };
  const stageProvider = stage === "extract" ? extractProvider : provider;
  if (stageProvider === "codex") {
    /* codex exec is an agent session per job, so it runs fewer at a time than
     * a completion CLI does. The model is left to the Codex config unless one
     * is named, because its model names are not the Claude ones. */
    return runScript("scripts/run-hubpedia-codex-jobs.ts", [
      `--input=${jobsPath}`,
      `--output=${outputPath}`,
      ...(codexModel ? [`--model=${codexModel}`] : []),
      `--limit=${jobCount}`,
      `--concurrency=${Math.min(codexConcurrency, 8)}`,
    ], "generate");
  }
  if (stageProvider === "claude") {
    return runScript("scripts/run-hubpedia-claude-jobs.ts", [
      `--input=${jobsPath}`,
      `--output=${outputPath}`,
      `--model=${stage === "extract" ? claudeExtractModel : claudeModel}`,
      `--limit=${jobCount}`,
      `--concurrency=${claudeConcurrency}`,
    ], "generate");
  }
  if (apiProvider === "chain" ? false : apiProvider === "opencode-go" ? !process.env.OPENCODE_API_KEY : !process.env.HUBPEDIA_LLM_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    throw new Error(`The ${stage} stage is set to the API provider but no key is present. Set HUBPEDIA_LLM_API_KEY (or DEEPSEEK_API_KEY) in the environment, run that stage on the Claude CLI (--provider=claude, --extract-provider=claude), or pass --skip-generate to reuse existing candidate files.`);
  }
  /* Without an explicit model the API script falls back to its own default,
   * which is one model for every stage — the hole that made "switch the
   * cheap stage over" quietly move the writing too. */
  const stageModel = stage === "extract" ? apiExtractModel : apiModel;
  return runScript("scripts/run-hubpedia-ai-jobs.ts", [
    `--input=${jobsPath}`,
    `--output=${outputPath}`,
    `--limit=${jobCount}`,
    ...(stageModel ? [`--model=${stageModel}`] : []),
    ...(apiProvider ? [`--provider=${apiProvider}`] : []),
    ...extraArgs,
  ], "generate");
}

function readIfPresent(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/* ---- research mode: plan file -> license gate -> fetch/chunk -> claims ->
 *      sourced article -> translation -> verify -> package ---- */

function runAsync(work: () => Promise<void>) {
  work().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}

if (mode === "research") runAsync(runResearchMode);
else if (mode === "hub-topics") {
  /* lib/server modules need the server-only stub; the child re-runs this file with it. */
  if (!reexecWithServerOnlyStub()) runAsync(runHubTopicsMode);
}
else if (mode === "unsourced") {
  const planPath = option("plan");
  if (!planPath) throw new Error(`--mode=unsourced requires --plan=unsourced-plan.json. ${USAGE}`);
  runAsync(() => runUnsourcedMode({
    planPath,
    batch,
    runDir,
    limit,
    dryRun,
    noPackage,
    generate: (jobsPath, outputPath, jobCount, extraArgs = []) => generate(jobsPath, outputPath, jobCount, extraArgs),
    runScript,
  }));
} else runQualityMode();

/* ---- hub-topics mode: candidate -> Hub material -> claims -> cited draft -> DB draft ----
 *
 * The material is public Hub activity that the eligibility gate still accepts
 * (DESIGN.md sections 2 and 7). The same two generation stages as research mode
 * do the writing: claims are extracted from short quotes and kept only when the
 * quote is verbatim, then a cited article is written from the surviving claims.
 * The result is stored as an AI draft (never public, noindex) whose claims carry
 * hub_item evidence. --dry-run prints the plan and writes nothing. */
async function runHubTopicsMode() {
  const candidateIds = (option("candidate") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!candidateIds.length || candidateIds.length > 5) throw new Error(`--mode=hub-topics requires --candidate=<id>[,<id>] with at most five ids. ${USAGE}`);
  const draftModule = await import("../lib/server/hubpedia-hub-topic-draft");
  const { db, dispose } = await openLocalHubDatabase();
  try {
    const materials: HubTopicMaterial[] = [];
    const refused: Array<{ candidateId: string; reason: string }> = [];
    for (const candidateId of candidateIds) {
      const loaded = await draftModule.loadHubTopicMaterial(db, candidateId);
      if (loaded.ok) materials.push(loaded.material);
      else refused.push({ candidateId, reason: loaded.reason });
    }
    const plans = materials.map((material) => draftModule.describeHubTopicDraftPlan(material));
    console.log(JSON.stringify({ stage: "hub-topics-plan", batch, runDir, dryRun, plans, refused }, null, 2));
    if (dryRun || !materials.length) return;

    const failures: string[] = [];
    const claimJobsPath = join(runDir, "hub-claims.jobs.json");
    const claimCandidatesPath = join(runDir, "hub-claims.candidates.jsonl");
    const claimJobs = materials.flatMap((material) => draftModule.planHubTopicClaimJobs(material));
    writeFileSync(claimJobsPath, `${JSON.stringify({ version: 1, mode: "extract-claims", jobs: claimJobs }, null, 2)}
`, "utf8");
    if (generate(claimJobsPath, claimCandidatesPath, claimJobs.length, ["--max-tokens=8192"], "extract").exitCode !== 0) {
      failures.push("Some claim-extraction jobs failed; rerun the same command to resume them.");
    }
    const claimed = collectResearchCandidates([readIfPresent(claimCandidatesPath)]);

    const checks = new Map<string, ReturnType<typeof draftModule.verifyHubTopicClaims>>();
    const articleJobs: ReturnType<typeof draftModule.planHubTopicArticleJob>[] = [];
    const outcomes: Array<{ candidateId: string; outcome: string; details?: unknown }> = [];
    for (const material of materials) {
      const slug = draftModule.hubTopicSlug(material.candidateId);
      const responses = [...claimed.claims.entries()].filter(([jobSlug]) => claimJobTopicSlug(jobSlug) === slug).map(([, response]) => response);
      const check = draftModule.verifyHubTopicClaims(responses, material);
      if (!check.sufficient) {
        outcomes.push({ candidateId: material.candidateId, outcome: "insufficient_evidence", details: check.reasons });
        continue;
      }
      checks.set(material.candidateId, check);
      articleJobs.push(draftModule.planHubTopicArticleJob(material, check.claims));
    }
    const articleJobsPath = join(runDir, "hub-article.jobs.json");
    const articleCandidatesPath = join(runDir, "hub-article.candidates.jsonl");
    writeFileSync(articleJobsPath, `${JSON.stringify({ version: 1, mode: "sourced-article", jobs: articleJobs }, null, 2)}
`, "utf8");
    if (generate(articleJobsPath, articleCandidatesPath, articleJobs.length, ["--max-tokens=8192"]).exitCode !== 0) {
      failures.push("Some article jobs failed; rerun the same command to resume them.");
    }
    const written = collectResearchCandidates([readIfPresent(articleCandidatesPath)]);
    for (const material of materials) {
      const check = checks.get(material.candidateId);
      const draft = written.articles.get(draftModule.hubTopicSlug(material.candidateId));
      if (!check || !draft) {
        if (check) outcomes.push({ candidateId: material.candidateId, outcome: "no_article_draft" });
        continue;
      }
      const saved = await draftModule.persistHubTopicDraft(db, {
        material, claims: check.claims, draft, runId: `hubtopic:${batch}:${draftModule.hubTopicSlug(material.candidateId)}`,
      });
      outcomes.push(saved.ok
        ? { candidateId: material.candidateId, outcome: "draft_saved", details: { articleSlug: saved.articleSlug, claims: saved.claimCount } }
        : { candidateId: material.candidateId, outcome: saved.reason, details: saved.details });
    }
    const report = {
      stage: "hub-topics-report", batch, generationFailures: failures,
      candidateErrors: [...claimed.errors, ...written.errors], outcomes,
      publication: "Drafts only: status draft, noindex, AI-written. Publication needs the 0116 gates and a human approval.",
    };
    writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}
`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await dispose();
  }
}

async function runResearchMode() {
  const planPath = option("plan");
  if (!planPath) throw new Error(`--mode=research requires --plan=research-plan.json. ${USAGE}`);
  const plan = factoryResearchPlanSchema.parse(JSON.parse(readFileSync(resolve(planPath), "utf8")));
  const gate = gateResearchPlan(plan);
  const topics = gate.accepted.slice(0, limit);
  /* Articles written in one batch belong to one subject area and are exactly
   * the ones that should reference each other — a solar-system batch whose
   * articles cannot link to each other is the wrong shape. Their slugs are
   * declared in the plan, so they are link targets from the start. If one of
   * them later fails verification, seed/index.ts unwraps the link at build
   * time and records the target as demand, so nothing dangles. */
  const batchTargets = gate.accepted.map((entry) => ({ slug: entry.topic.slug, title: entry.topic.title }));
  /* Two different sets, and conflating them cost a batch.
   *
   * Generation may aim links at any accepted topic, because which ones survive
   * is not known yet. Verification may not: a link to a sibling that never got
   * assembled is unwrapped after packaging, and the article then falls below
   * the link floor at the final audit — passing here and failing there. So the
   * verification pool starts from the catalog alone and lets the fixed point
   * add back only the drafts that actually exist. */
  const catalogSlugs = new Set(VIEWABLE_SEED_ARTICLES.map((article) => article.slug));
  const seedTargets = new Map<string, string>([
    ...VIEWABLE_SEED_ARTICLES.map((article) => [article.slug, article.title] as const),
    ...batchTargets.map((target) => [target.slug, target.title] as const),
  ]);

  /* Chunks are keyed by page, not by topic.
   *
   * Chunk ids anchor claim-evidence quotes, so a page chunked twice produces
   * two sets of ids for the same text and the extraction has to be run
   * against each. Keying the store by URL gives every topic that cites a page
   * the same chunks, which is what makes one reading serve all of them.
   * The file is still the resume cache: same page, same ids, on every rerun. */
  const pageStoreSchema = z.array(z.object({
    url: z.string(),
    chunks: z.array(factoryResearchChunkSchema),
    fetchError: z.string().nullable(),
  }).strict());
  const chunksPath = join(runDir, "chunks.json");
  const pageStore = new Map<string, { chunks: FactoryResearchChunk[]; fetchError: string | null }>();
  if (existsSync(chunksPath)) {
    /* An older run directory holds the per-topic shape. It cannot be reused,
     * and refusing to start over it would strand the batch, so it is simply
     * re-fetched. */
    const parsed = pageStoreSchema.safeParse(JSON.parse(readFileSync(chunksPath, "utf8")));
    if (parsed.success) for (const entry of parsed.data) pageStore.set(entry.url, { chunks: entry.chunks, fetchError: entry.fetchError });
  }
  const pageUrls = [...new Set(topics.flatMap((entry) => entry.approvedSources.map((source) => source.url)))];
  const sourceByUrl = new Map(topics.flatMap((entry) => entry.approvedSources.map((source) => [source.url, source] as const)));
  for (const url of pageUrls) {
    if (pageStore.has(url) || dryRun) continue;
    const source = sourceByUrl.get(url)!;
    try {
      const fetched = await fetchSource(url, FACTORY_RESEARCH_FETCH);
      const text = sourceText(fetched);
      pageStore.set(url, { chunks: chunkResearchText({ url, title: source.title }, text), fetchError: null });
    } catch (error) {
      pageStore.set(url, { chunks: [], fetchError: error instanceof Error ? error.message : "fetch failed" });
    }
  }
  writeFileSync(chunksPath, `${JSON.stringify([...pageStore.entries()].map(([url, entry]) => ({ url, ...entry })), null, 2)}\n`, "utf8");

  const chunksForTopic = (entry: (typeof topics)[number]) =>
    entry.approvedSources
      .flatMap((source) => pageStore.get(source.url)?.chunks ?? [])
      .slice(0, FACTORY_RESEARCH_CHUNKING.maxChunksPerTopic);
  const fetchErrorsForTopic = (entry: (typeof topics)[number]) =>
    entry.approvedSources.flatMap((source) => {
      const failure = pageStore.get(source.url)?.fetchError;
      return failure ? [`${source.url}: ${failure}`] : [];
    });

  const researchPlanSummary = {
    batch,
    runDir,
    mode,
    plannedTopics: plan.topics.length,
    licenseRejected: gate.rejected,
    acceptedTopics: topics.map((entry) => ({
      slug: entry.topic.slug,
      approvedSources: entry.approvedSources.length,
      rejectedSources: entry.rejectedSources,
      chunks: chunksForTopic(entry).length,
      fetchErrors: fetchErrorsForTopic(entry),
    })),
  };
  console.log(JSON.stringify({ stage: "research-plan", ...researchPlanSummary }, null, 2));
  if (dryRun) return;

  const researchFailures: string[] = [];
  /* A page cited by one topic is read for that topic; a page cited by several
   * is read once for all of them, and each claim says which topic it belongs
   * to. This is where the saving lives: half the extraction calls made so far
   * were the second kind of page being read again for the next sibling. */
  const topicsByPage = new Map<string, Array<(typeof topics)[number]>>();
  for (const entry of topics) {
    for (const source of entry.approvedSources) {
      topicsByPage.set(source.url, [...(topicsByPage.get(source.url) ?? []), entry]);
    }
  }
  const sharedPages = pageUrls.filter((url) => (topicsByPage.get(url) ?? []).length > 1 && (pageStore.get(url)?.chunks.length ?? 0) > 0);
  const claimJobs = [
    ...topics.flatMap((entry) => {
      const own = entry.approvedSources
        .filter((source) => !sharedPages.includes(source.url))
        .flatMap((source) => pageStore.get(source.url)?.chunks ?? [])
        .slice(0, FACTORY_RESEARCH_CHUNKING.maxChunksPerTopic);
      return own.length ? planFactoryClaimJobs({ slug: entry.topic.slug, title: entry.topic.title }, own) : [];
    }),
    ...sharedPages.flatMap((url, index) => planSharedFactoryClaimJobs(
      { url, index },
      (topicsByPage.get(url) ?? []).map((entry) => ({ slug: entry.topic.slug, title: entry.topic.title })),
      pageStore.get(url)!.chunks,
    )),
  ];
  const claimJobsPath = join(runDir, "claims.jobs.json");
  const claimCandidatesPath = join(runDir, "claims.candidates.jsonl");
  writeFileSync(claimJobsPath, `${JSON.stringify({ version: 1, mode: "extract-claims", jobs: claimJobs }, null, 2)}\n`, "utf8");
  if (generate(claimJobsPath, claimCandidatesPath, claimJobs.length, ["--max-tokens=8192"], "extract").exitCode !== 0) {
    researchFailures.push("Some claim-extraction jobs failed; rerun the same command to resume them.");
  }
  let candidates = collectResearchCandidates([readIfPresent(claimCandidatesPath)]);
  const claimResponsesByTopic = new Map<string, FactoryClaimsResponse[]>();
  const sharedResponses: FactoryClaimsResponse[] = [];
  const slugByTitle = new Map(topics.map((entry) => [entry.topic.title, entry.topic.slug]));
  for (const [jobSlug, response] of candidates.claims) {
    if (sharedClaimJobPageIndex(jobSlug) !== null) { sharedResponses.push(response); continue; }
    const topicSlug = claimJobTopicSlug(jobSlug);
    if (!topicSlug) continue;
    claimResponsesByTopic.set(topicSlug, [...(claimResponsesByTopic.get(topicSlug) ?? []), response]);
  }
  /* A shared claim is routed by the topic title it names. One that names
   * nothing, or names a title outside this batch, is dropped: guessing which
   * article should carry a fact is exactly what the evidence trail exists to
   * prevent. */
  const allChunks = [...pageStore.values()].flatMap((entry) => entry.chunks);
  for (const claim of verifyFactoryClaims(sharedResponses, allChunks)) {
    const slugs = [...new Set((claim.topics ?? []).flatMap((title) => {
      const slug = slugByTitle.get(title);
      return slug ? [slug] : [];
    }))];
    for (const slug of slugs) {
      claimResponsesByTopic.set(slug, [...(claimResponsesByTopic.get(slug) ?? []), {
        claims: [{ statement: claim.statement, confidence: claim.confidence, evidence: claim.evidence.map(({ chunkId, quote }) => ({ chunkId, quote })) }],
      }]);
    }
  }
  const verifiedClaimsByTopic = new Map(topics.map((entry) => [
    entry.topic.slug,
    verifyFactoryClaims(claimResponsesByTopic.get(entry.topic.slug) ?? [], chunksForTopic(entry)),
  ]));
  writeFileSync(join(runDir, "claims.json"), `${JSON.stringify(
    [...verifiedClaimsByTopic.entries()].map(([slug, claims]) => ({ slug, claims })), null, 2,
  )}\n`, "utf8");

  /* Ordered per topic, because the job planner has to cap the list and the cap
   * has to cut the far end rather than the near one. A topic's most linkable
   * neighbours are the siblings written beside it in the same wave, then the
   * articles filed under the same category; everything else is filler that a
   * writer will not reach for anyway. */
  const catalogTargets = VIEWABLE_SEED_ARTICLES.map((article) => ({ slug: article.slug, title: article.title, categoryLabel: article.categoryLabel }));
  const linkTargetsFor = (topic: { slug: string; categoryLabel: string }) => {
    const siblings = batchTargets.filter((target) => target.slug !== topic.slug);
    const siblingSlugs = new Set(siblings.map((target) => target.slug));
    const sameCategory = catalogTargets.filter((target) => target.categoryLabel === topic.categoryLabel && !siblingSlugs.has(target.slug));
    const seen = new Set([...siblingSlugs, ...sameCategory.map((target) => target.slug)]);
    const rest = catalogTargets.filter((target) => !seen.has(target.slug));
    return [...siblings, ...sameCategory, ...rest].map(({ slug, title }) => ({ slug, title }));
  };
  /* Evidence floor before generation: writing from too little material
   * produces a stub padded with remarks about its own sourcing, and every
   * token spent on it is wasted. Report the shortfall instead. */
  const insufficientEvidence: Array<{ slug: string; issues: string[] }> = [];
  const writableTopics = topics.filter((entry) => {
    const sufficiency = assessEvidenceSufficiency(verifiedClaimsByTopic.get(entry.topic.slug) ?? []);
    if (!sufficiency.sufficient) insufficientEvidence.push({ slug: entry.topic.slug, issues: sufficiency.reasons });
    return sufficiency.sufficient;
  });
  const articleJobs = writableTopics
    .map((entry) => planFactorySourcedArticleJob(entry.topic, verifiedClaimsByTopic.get(entry.topic.slug)!, linkTargetsFor(entry.topic)));
  const articleJobsPath = join(runDir, "sourced-article.jobs.json");
  const articleCandidatesPath = join(runDir, "sourced-article.candidates.jsonl");
  writeFileSync(articleJobsPath, `${JSON.stringify({ version: 1, mode: "sourced-article", jobs: articleJobs }, null, 2)}\n`, "utf8");
  if (generate(articleJobsPath, articleCandidatesPath, articleJobs.length, ["--max-tokens=8192"]).exitCode !== 0) {
    researchFailures.push("Some sourced-article jobs failed; rerun the same command to resume them.");
  }
  candidates = collectResearchCandidates([readIfPresent(claimCandidatesPath), readIfPresent(articleCandidatesPath)]);

  const records: FactorySourcedRecord[] = [];
  const assemblyFailures: Array<{ slug: string; issues: string[] }> = [];
  for (const entry of writableTopics) {
    const draft = candidates.articles.get(entry.topic.slug);
    const claims = verifiedClaimsByTopic.get(entry.topic.slug) ?? [];
    if (!draft || !claims.length) continue;
    try {
      records.push(assembleFactorySourcedRecord({
        topic: entry.topic,
        approvedSources: entry.approvedSources,
        claims,
        draft,
        allowedTargets: seedTargets,
      }));
    } catch (error) {
      assemblyFailures.push({ slug: entry.topic.slug, issues: [error instanceof Error ? error.message : "assembly failed"] });
    }
  }

  const followUpJobs = buildFactoryTranslationJobs(records.map((record) => ({
    slug: record.slug,
    ja: { title: record.title, summary: record.summary, bodyMarkdown: record.bodyMarkdown },
  })));
  const followUpJobsPath = join(runDir, "sourced-translate.jobs.json");
  const followUpCandidatesPathResearch = join(runDir, "sourced-translate.candidates.jsonl");
  writeFileSync(followUpJobsPath, `${JSON.stringify(followUpJobs, null, 2)}\n`, "utf8");
  if (generate(followUpJobsPath, followUpCandidatesPathResearch, followUpJobs.jobs.length, ["--max-tokens=8192"]).exitCode !== 0) {
    researchFailures.push("Some sourced translation jobs failed; rerun the same command to resume them.");
  }
  const translated = collectResearchCandidates([readIfPresent(followUpCandidatesPathResearch)]);
  for (const record of records) {
    const english = translated.translations.get(record.slug);
    if (english) record.translations = { en: english };
  }

  const drafts: FactoryQualityDraft[] = [];
  const sourcesBySlug = new Map<string, readonly unknown[]>();
  const sourcedIssuesBySlug = new Map<string, string[]>();
  for (const record of records) {
    const issues = auditFactorySourcedRecord(record);
    if (!record.translations?.en) issues.push(`${record.slug}: English translation is not available yet.`);
    if (issues.length) {
      sourcedIssuesBySlug.set(record.slug, issues);
      continue;
    }
    drafts.push({
      slug: record.slug,
      ja: { title: record.title, summary: record.summary, bodyMarkdown: record.bodyMarkdown },
      en: record.translations!.en,
    });
    sourcesBySlug.set(record.slug, record.sources);
  }
  /* Relatedness is judged over the catalog plus this batch, since batch
   * articles become linkable neighbours the moment they are packaged. */
  const relatedSlugsBySlug = buildRelatedSlugIndex([
    ...VIEWABLE_SEED_ARTICLES,
    ...records.map((record) => ({
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      bodyMarkdown: record.bodyMarkdown,
      topicType: record.topicType,
      categoryLabel: record.categoryLabel,
    })),
  ]);
  /* Verification runs twice, and the second run is the one that matters.
   *
   * Articles in a batch are offered each other as link targets, so a link may
   * point at a sibling that then fails its own verification. The first pass
   * cannot know which siblings survive; the second re-checks the survivors
   * against exactly the slugs that will exist, which is what the independent
   * audit gate sees. Without it a batch passes here and is rejected there,
   * and the whole batch is discarded for one dangling link. */
  /* Verification runs to a fixed point: batch siblings are link targets, so
   * one removal can strip links from the next. */
  const verification = verifyFactoryDraftsToFixedPoint(drafts, catalogSlugs, { sourcesBySlug, relatedSlugsBySlug });
  const survivingSlugs = new Set([
    ...VIEWABLE_SEED_ARTICLES.map((article) => article.slug),
    ...verification.passed.map((draft) => draft.slug),
  ]);
  for (const record of records) {
    const draft = verification.passed.find((entry) => entry.slug === record.slug);
    if (!draft) continue;
    record.bodyMarkdown = unwrapUnresolvableInternalLinks(record.bodyMarkdown, survivingSlugs);
    if (record.translations?.en) {
      record.translations = { en: { ...record.translations.en, bodyMarkdown: unwrapUnresolvableInternalLinks(record.translations.en.bodyMarkdown, survivingSlugs) } };
    }
  }

  const passedRecords = records.filter((record) => verification.passed.some((draft) => draft.slug === record.slug));
  const failed = [
    ...insufficientEvidence,
    ...assemblyFailures,
    ...[...sourcedIssuesBySlug.entries()].map(([slug, issues]) => ({ slug, issues })),
    ...verification.failed,
  ];

  const report = {
    stage: "research-report",
    ...researchPlanSummary,
    generationFailures: researchFailures,
    candidateErrors: [...candidates.errors, ...translated.errors],
    verifiedClaims: Object.fromEntries([...verifiedClaimsByTopic.entries()].map(([slug, claims]) => [slug, claims.length])),
    assembled: records.length,
    passed: passedRecords.map((record) => record.slug),
    failed,
    packagedFile: null as string | null,
    publication: "Reader layer only. Publication approval stays manual in publication-manifest.ts.",
  };
  writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!noPackage && passedRecords.length) {
    const batchFileName = `sourced-factory-${batch}.bilingual.json`;
    const batchPath = join(hubDir, "lib", "encyclopedia", "seed", batchFileName);
    writeFileSync(batchPath, `${JSON.stringify(passedRecords.map((record) => factorySourcedRecordSchema.parse(record)), null, 2)}\n`, "utf8");
    runScript("scripts/generate-hubpedia-quality-manifest.mjs", [], "manifest");
    const gateResult = runScript("scripts/audit-hubpedia-sourced-batches.ts", [`lib/encyclopedia/seed/${batchFileName}`], "audit-gate");
    if (gateResult.exitCode !== 0) {
      rmSync(batchPath, { force: true });
      runScript("scripts/generate-hubpedia-quality-manifest.mjs", [], "manifest");
      throw new Error("Final sourced audit gate rejected the packaged batch; it was removed and unregistered. See report.json.");
    }
    report.packagedFile = `lib/encyclopedia/seed/${batchFileName}`;
    writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
  if (researchFailures.length) process.exitCode = 1;
}

function runQualityMode() {

/* ---- plan ---- */

const audit = auditCatalog(VIEWABLE_SEED_ARTICLES);
const shortSlugs = new Set(audit.shortJapaneseArticles);
const allowedSlugs = new Set(VIEWABLE_SEED_ARTICLES.map((article) => article.slug));
const allowedTargets = new Map(VIEWABLE_SEED_ARTICLES.map((article) => [article.slug, article.title]));

const expandPlan = mode === "translate"
  ? { version: 1 as const, mode: "expand" as const, jobs: [] }
  : planFactoryExpandJobs(VIEWABLE_SEED_ARTICLES, shortSlugs, minimumCharacters);
expandPlan.jobs = expandPlan.jobs.slice(0, limit);

const translatePlan = mode === "expand"
  ? { file: { version: 1 as const, mode: "translate-en" as const, jobs: [] }, skipped: [] }
  : planFactoryTranslationJobs(VIEWABLE_SEED_ARTICLES, shortSlugs, allowedSlugs);
translatePlan.file.jobs = translatePlan.file.jobs.slice(0, limit);

const expandJobsPath = writeJobFile("expand.jobs.json", expandPlan);
const translateJobsPath = writeJobFile("translate.jobs.json", translatePlan.file);
const expandCandidatesPath = join(runDir, "expand.candidates.jsonl");
const translateCandidatesPath = join(runDir, "translate.candidates.jsonl");
const followUpJobsPath = join(runDir, "translate-followup.jobs.json");
const followUpCandidatesPath = join(runDir, "translate-followup.candidates.jsonl");

const planSummary = {
  batch,
  runDir,
  mode,
  expandJobs: expandPlan.jobs.length,
  translateJobs: translatePlan.file.jobs.length,
  translateSkippedByPrecheck: translatePlan.skipped.length,
};
console.log(JSON.stringify({ stage: "plan", ...planSummary }, null, 2));
if (dryRun) process.exit(0);

/* ---- generate ---- */

const generationFailures: string[] = [];
if (generate(expandJobsPath, expandCandidatesPath, expandPlan.jobs.length).exitCode !== 0) {
  generationFailures.push("Some expand jobs failed; rerun the same command to resume them.");
}
if (generate(translateJobsPath, translateCandidatesPath, translatePlan.file.jobs.length).exitCode !== 0) {
  generationFailures.push("Some translate jobs failed; rerun the same command to resume them.");
}

/* ---- assemble (with the expand -> translate follow-up loop) ---- */

let outputs = collectFactoryCandidates([
  readIfPresent(expandCandidatesPath),
  readIfPresent(translateCandidatesPath),
  readIfPresent(followUpCandidatesPath),
]);
let assembly = assembleFactoryDrafts({
  expanded: outputs.expanded,
  translations: outputs.translations,
  seedArticles: VIEWABLE_SEED_ARTICLES,
  allowedTargets,
});
if (assembly.needsTranslation.length && !skipGenerate) {
  const followUp = buildFactoryTranslationJobs(assembly.needsTranslation);
  writeFileSync(followUpJobsPath, `${JSON.stringify(followUp, null, 2)}\n`, "utf8");
  if (generate(followUpJobsPath, followUpCandidatesPath, followUp.jobs.length).exitCode !== 0) {
    generationFailures.push("Some follow-up translation jobs failed; rerun the same command to resume them.");
  }
  outputs = collectFactoryCandidates([
    readIfPresent(expandCandidatesPath),
    readIfPresent(translateCandidatesPath),
    readIfPresent(followUpCandidatesPath),
  ]);
  assembly = assembleFactoryDrafts({
    expanded: outputs.expanded,
    translations: outputs.translations,
    seedArticles: VIEWABLE_SEED_ARTICLES,
    allowedTargets,
  });
}

/* ---- verify ---- */

const verification = verifyFactoryDrafts(assembly.drafts, allowedSlugs);
const report = {
  stage: "report",
  ...planSummary,
  generationFailures,
  candidateErrors: outputs.errors,
  assembled: assembly.drafts.length,
  awaitingTranslation: assembly.needsTranslation.map((entry) => entry.slug),
  assemblySkipped: assembly.skipped,
  passed: verification.passed.map((draft) => draft.slug),
  failed: verification.failed,
  packagedFile: null as string | null,
  publication: "Reader-quality layer only. Publication approval stays manual in publication-manifest.ts.",
};
writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

/* ---- package ---- */

if (!noPackage && verification.passed.length) {
  const batchFileName = `reader-quality-factory-${batch}.bilingual.json`;
  const batchPath = join(hubDir, "lib", "encyclopedia", "seed", batchFileName);
  writeFileSync(batchPath, `${JSON.stringify(verification.passed, null, 2)}\n`, "utf8");
  runScript("scripts/generate-hubpedia-quality-manifest.mjs", [], "manifest");
  const gate = runScript("scripts/audit-hubpedia-quality-batches.ts", [`lib/encyclopedia/seed/${batchFileName}`], "audit-gate");
  if (gate.exitCode !== 0) {
    /* Fail closed: an unregistered batch is recoverable, a bad one is not. */
    rmSync(batchPath, { force: true });
    runScript("scripts/generate-hubpedia-quality-manifest.mjs", [], "manifest");
    throw new Error("Final audit gate rejected the packaged batch; it was removed and unregistered. See report.json.");
  }
  report.packagedFile = `lib/encyclopedia/seed/${batchFileName}`;
  writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
/* Rejected drafts are an expected, reported outcome; an interrupted
 * generation pass is not, because rerunning the command would finish it. */
if (generationFailures.length) process.exitCode = 1;

}
