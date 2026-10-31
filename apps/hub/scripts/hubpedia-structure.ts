import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMissingArticlePlanSkeleton, buildStructureReport } from "../lib/encyclopedia/structure-engine";
import { HUBPEDIA_UNRESOLVED_LINK_TARGETS, VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

/*
 * Structure report for the whole encyclopedia: link graph, category balance,
 * and demand for articles that do not exist yet. --queues additionally writes
 * the demand as a research-plan skeleton for `hubpedia:factory --mode=research`
 * (the curator still supplies and reviews the sources).
 */

const hubDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writeQueues = process.argv.includes("--queues");
const full = process.argv.includes("--full");

const report = buildStructureReport(VIEWABLE_SEED_ARTICLES, HUBPEDIA_UNRESOLVED_LINK_TARGETS);

const summary = full ? report : {
  articleCount: report.articleCount,
  graph: {
    ...report.graph,
    orphanSlugs: report.graph.orphanSlugs.slice(0, 20),
    deadEndSlugs: report.graph.deadEndSlugs.slice(0, 20),
    isolatedSlugs: report.graph.isolatedSlugs.slice(0, 20),
  },
  categories: {
    ...report.categories,
    distribution: report.categories.distribution.slice(0, 12),
    uncategorizedSlugs: report.categories.uncategorizedSlugs.slice(0, 20),
  },
  demand: {
    missingLinkTargets: report.demand.missingLinkTargets.slice(0, 20),
  },
};
console.log(JSON.stringify(summary, null, 2));

if (writeQueues) {
  const queueDir = join(hubDir, "data", "factory", "structure");
  mkdirSync(queueDir, { recursive: true });
  writeFileSync(join(queueDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(
    join(queueDir, "missing-articles.plan.json"),
    `${JSON.stringify(buildMissingArticlePlanSkeleton(report.demand.missingLinkTargets), null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ queues: ["data/factory/structure/report.json", "data/factory/structure/missing-articles.plan.json"] }, null, 2));
}
