import { readFileSync } from "node:fs";

/*
 * Summarises a stage log written by the ledger scripts (HUBPEDIA_LEDGER_STAGE_LOG / --stage-log): per stage, total
 * wall time, and the share of the total with model time removed. Model time is the "model" lines; compose, translate
 * and extract-chunk contain it, so it is subtracted from those stages by call stage.
 *
 *   npx tsx scripts/hubpedia-ledger-stage-report.ts <stages.jsonl>
 */
type Line = { stage: string; ms: number; callStage?: string; result?: string; modelCalls?: number };
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Line);
const total = (stage: string, filter: (line: Line) => boolean = () => true) => lines.filter((line) => line.stage === stage && filter(line)).reduce((sum, line) => sum + line.ms, 0);
const count = (stage: string) => lines.filter((line) => line.stage === stage).length;

const modelBy = (callStage: string) => total("model", (line) => line.callStage === callStage);
const rows: Array<{ stage: string; n: number; wallMs: number; modelMs: number; localMs: number }> = [];
const push = (stage: string, modelStages: string[] = []) => {
  const wallMs = total(stage);
  const modelMs = modelStages.reduce((sum, name) => sum + modelBy(name), 0);
  rows.push({ stage, n: count(stage), wallMs, modelMs, localMs: wallMs - modelMs });
};
push("fetch"); push("ingest-store"); push("prescreen"); push("extract-chunk", ["extract"]); push("dedupe", ["judge"]); push("stats");
push("select"); push("compose", ["compose"]); push("sentence-check"); push("translate", ["translate"]); push("store");
const topicWall = total("topic");
const staged = rows.reduce((sum, row) => sum + row.wallMs, 0);
const modelTotal = total("model");
const localTotal = topicWall - modelTotal;
const articles = lines.filter((line) => line.stage === "topic" && line.result === "pass").length;
console.log(JSON.stringify({
  topics: count("topic"), articles, topicWallMs: Math.round(topicWall), modelMs: Math.round(modelTotal), localMs: Math.round(localTotal),
  unattributedLocalMs: Math.round(topicWall - staged),
  modelCallsTotal: count("model"), modelCallsByStage: Object.fromEntries(["extract", "judge", "compose", "translate"].map((name) => [name, lines.filter((line) => line.stage === "model" && line.callStage === name).length])),
}));
for (const row of rows) {
  console.log(`${row.stage.padEnd(15)} n=${String(row.n).padStart(4)} wall=${row.wallMs.toFixed(1).padStart(9)}ms local=${row.localMs.toFixed(1).padStart(9)}ms share_of_local=${localTotal > 0 ? ((row.localMs / localTotal) * 100).toFixed(1).padStart(5) : "  n/a"}%`);
}
console.log(`${"unattributed".padEnd(15)} local=${(topicWall - staged).toFixed(1).padStart(9)}ms share_of_local=${localTotal > 0 ? (((topicWall - staged) / localTotal) * 100).toFixed(1) : "n/a"}%`);
