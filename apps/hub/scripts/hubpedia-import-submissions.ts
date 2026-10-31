import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

/*
 * Turns accepted reader submissions into a spec the autorun queue consumes.
 *
 * The step exists because generation costs model time: screening at
 * submission decides whether a proposal is coherent, and a person decides
 * which coherent proposals are worth running. Nothing here re-checks
 * licences or evidence — the factory does that, and doing it twice in
 * different code is how the two drift apart.
 *
 * Input is the JSON the admin listing returns, so the flow is: review the
 * listing, keep the rows worth producing, pipe them here.
 */

const rowSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  categoryLabel: z.string().trim().min(1),
  sources: z.array(z.object({
    url: z.string().url(),
    title: z.string().trim().min(1),
    notes: z.string().trim().min(1),
  })).min(2),
}).passthrough();

const inputSchema = z.union([
  z.object({ submissions: z.array(rowSchema) }).passthrough(),
  z.array(rowSchema),
]);

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const output = option("output");
  if (!output) throw new Error("Usage: npm run hubpedia:import-submissions -- --output=data/factory/specs/queue/<name>.json < listing.json");
  const raw = await readStdin();
  if (!raw.trim()) throw new Error("No submission JSON on stdin.");
  const parsed = inputSchema.parse(JSON.parse(raw));
  const rows = Array.isArray(parsed) ? parsed : parsed.submissions;

  const seen = new Set<string>();
  const topics = rows.filter((row) => {
    if (seen.has(row.slug)) return false;
    seen.add(row.slug);
    return true;
  }).map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    topicType: "concept",
    categoryLabel: row.categoryLabel,
    sources: row.sources,
  }));
  if (!topics.length) throw new Error("No submissions to import.");

  const absolute = resolve(output);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify({ version: 1, topics }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    spec: absolute,
    topics: topics.length,
    slugs: topics.map((topic) => topic.slug),
    note: "Queued as a spec. The factory's licence gate, quote matching, evidence floor, and quality checks all still apply.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exitCode = 1;
});
