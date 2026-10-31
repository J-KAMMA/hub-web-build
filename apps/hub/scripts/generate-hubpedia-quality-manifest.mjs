import { readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const seedDirectory = path.resolve(scriptDirectory, "../lib/encyclopedia/seed");
const outputPath = path.join(seedDirectory, "reader-quality-manifest.generated.ts");

/* Lanes run in parallel and every one of them regenerates these manifests
 * after packaging a batch. Writing the same path from several processes at
 * once fails outright on Windows, and a failed regeneration leaves the new
 * batch unregistered — the final audit then reports the batch own siblings
 * as missing link targets and throws the whole batch away. Writing to a
 * process-unique temporary file and renaming it into place makes each write
 * atomic: concurrent writers no longer collide, and the last one to finish
 * leaves a complete manifest, since each regenerates from the whole seed
 * directory rather than appending to what it found. */
async function writeAtomic(targetPath, contents) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, targetPath);
}

const fileNames = (await readdir(seedDirectory))
  .filter((fileName) => /^reader-quality-.*\.bilingual\.json$/.test(fileName))
  .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));

const imports = fileNames
  .map((fileName, index) => `import batch${index} from "./${fileName}";`)
  .join("\n");
const batches = fileNames
  .map((fileName, index) => `  { fileName: "${fileName}", articles: batch${index} as ReaderQualityUpgrade[] },`)
  .join("\n");

const output = `${imports}

export interface ReaderQualityUpgrade {
  slug: string;
  ja: { title: string; summary: string; bodyMarkdown: string };
  en: { title: string; summary: string; bodyMarkdown: string };
}

export const READER_QUALITY_BATCHES: ReadonlyArray<{
  fileName: string;
  articles: ReaderQualityUpgrade[];
}> = [
${batches}
];

export const READER_QUALITY_ARTICLES = READER_QUALITY_BATCHES.flatMap((batch) => batch.articles);
export const READER_QUALITY_RECENT_SLUGS = READER_QUALITY_ARTICLES.map((article) => article.slug);
`;

await writeAtomic(outputPath, output);

/* Source-backed factory batches register the same way: drop the file, run
 * this generator. The manifest always exists so seed/index.ts can import it
 * statically even when no sourced batch has shipped yet. */
const sourcedFileNames = (await readdir(seedDirectory))
  .filter((fileName) => /^sourced-factory-.*\.bilingual\.json$/.test(fileName))
  .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));

const sourcedImports = sourcedFileNames
  .map((fileName, index) => `import sourcedBatch${index} from "./${fileName}";`)
  .join("\n");
const sourcedBatches = sourcedFileNames
  .map((fileName, index) => `  { fileName: "${fileName}", records: sourcedBatch${index} as SourcedFactoryRecord[] },`)
  .join("\n");

const sourcedOutput = `${sourcedImports ? `${sourcedImports}\n\n` : ""}import type { FactorySourcedRecord } from "@/lib/encyclopedia/factory-research";

export type SourcedFactoryRecord = FactorySourcedRecord;

export const SOURCED_FACTORY_BATCHES: ReadonlyArray<{
  fileName: string;
  records: SourcedFactoryRecord[];
}> = [
${sourcedBatches}
];

export const SOURCED_FACTORY_RECORDS = SOURCED_FACTORY_BATCHES.flatMap((batch) => batch.records);
`;

await writeAtomic(path.join(seedDirectory, "sourced-factory-manifest.generated.ts"), sourcedOutput);

const unsourcedFileNames = (await readdir(seedDirectory))
  .filter((fileName) => /^unsourced-factory-.*\.bilingual\.json$/.test(fileName))
  .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));

const unsourcedImports = unsourcedFileNames
  .map((fileName, index) => `import unsourcedBatch${index} from "./${fileName}";`)
  .join("\n");
const unsourcedBatches = unsourcedFileNames
  .map((fileName, index) => `  { fileName: "${fileName}", records: unsourcedBatch${index} as UnsourcedFactoryRecord[] },`)
  .join("\n");

const unsourcedOutput = `${unsourcedImports ? `${unsourcedImports}\n\n` : ""}import type { FactoryUnsourcedRecord } from "@/lib/encyclopedia/factory-research";

export type UnsourcedFactoryRecord = FactoryUnsourcedRecord;

export const UNSOURCED_FACTORY_BATCHES: ReadonlyArray<{
  fileName: string;
  records: UnsourcedFactoryRecord[];
}> = [
${unsourcedBatches}
];

export const UNSOURCED_FACTORY_RECORDS = UNSOURCED_FACTORY_BATCHES.flatMap((batch) => batch.records);
`;

await writeAtomic(path.join(seedDirectory, "unsourced-factory-manifest.generated.ts"), unsourcedOutput);

/* The shared-shell rail cannot import the seed index (every batch would land
 * in every SNS route's bundle), so it is fed by this dedicated compact
 * manifest: approved slugs only, with just the fields the rail renders. The
 * approved list lives in publication-manifest.ts, which this script cannot
 * import — the slug literals are extracted from the array instead. */
const { readFile } = await import("node:fs/promises");
const manifestSource = await readFile(
  path.resolve(scriptDirectory, "../lib/encyclopedia/publication-manifest.ts"),
  "utf8",
);
const approvedMatch = manifestSource.match(
  /export const HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS = \[([\s\S]*?)\] as const;/,
);
if (!approvedMatch) throw new Error("Could not find HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS in publication-manifest.ts");
const approvedSlugs = new Set([...approvedMatch[1].matchAll(/"([a-z0-9]+(?:-[a-z0-9]+)*)"/g)].map((match) => match[1]));

const railEntries = [];
for (const fileName of sourcedFileNames) {
  const records = JSON.parse(await readFile(path.join(seedDirectory, fileName), "utf8"));
  for (const record of records) {
    if (approvedSlugs.has(record.slug)) {
      railEntries.push({ slug: record.slug, title: record.title, category: record.categoryLabel, summary: record.summary });
    }
  }
}
railEntries.sort((left, right) => left.slug.localeCompare(right.slug));

const railOutput = `export interface HubpediaRailEntry {
  slug: string;
  title: string;
  category: string;
  summary: string;
}

export const HUBPEDIA_RAIL_ENTRIES: HubpediaRailEntry[] = ${JSON.stringify(railEntries, null, 2)};
`;

await writeAtomic(path.join(seedDirectory, "hubpedia-rail-manifest.generated.ts"), railOutput);
console.log(`Generated Hubpedia quality manifest for ${fileNames.length} batches and sourced factory manifest for ${sourcedFileNames.length} batches, rail manifest for ${railEntries.length} approved articles.`);
