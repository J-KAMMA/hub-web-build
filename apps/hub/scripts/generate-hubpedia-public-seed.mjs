import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPublicClaimRecords,
  buildPublicSeedSnapshot,
  serializeGeneratedJson,
} from "../lib/encyclopedia/seed/public-snapshot.ts";

/*
 * Writes the approved Hubpedia subset that request paths read:
 *   lib/encyclopedia/seed/public-seed.generated.json   (articles)
 *   lib/encyclopedia/seed/public-claims.generated.json (claim graph, MCP only)
 * The full factory catalog stays a build-time input; see
 * lib/encyclopedia/seed/public-snapshot.ts.
 */
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const seedDirectory = path.resolve(scriptDirectory, "../lib/encyclopedia/seed");

async function writeIfChanged(fileName, output) {
  const outputPath = path.join(seedDirectory, fileName);
  const existing = await readFile(outputPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  // A running Windows dev server may still have this generated file open.
  // Leave identical content in place; changed content must still be written.
  if (existing !== output) await writeFile(outputPath, output, "utf8");
}

const snapshot = buildPublicSeedSnapshot();
const claims = buildPublicClaimRecords();
await writeIfChanged("public-seed.generated.json", serializeGeneratedJson(snapshot));
await writeIfChanged("public-claims.generated.json", serializeGeneratedJson(claims));
console.log(`Generated the public Hubpedia seed: ${snapshot.articles.length} articles, ${snapshot.readerReadyIndexes.length} reader-ready, ${claims.length} claim records.`);
