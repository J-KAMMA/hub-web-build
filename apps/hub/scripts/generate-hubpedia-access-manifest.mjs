import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const seedDirectory = path.resolve(scriptDirectory, "../lib/encyclopedia/seed");
const outputPath = path.join(seedDirectory, "access-priority-manifest.generated.ts");

const fileNames = (await readdir(seedDirectory))
  .filter((fileName) => /^generation7-access-priority-.*\.bilingual\.json$/.test(fileName))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

const imports = fileNames
  .map((fileName, index) => `import batch${index} from "./${fileName}";`)
  .join("\n");
const batches = fileNames
  .map((fileName, index) => `  { fileName: "${fileName}", articles: batch${index} as AccessPriorityArticle[] },`)
  .join("\n");

const output = `${imports}

export interface AccessPriorityArticle {
  slug: string;
  categoryLabel: string;
  topicType: string;
  popularityBasis: {
    source: string;
    project: string;
    period: string;
    views: number;
  };
  ja: { title: string; summary: string; bodyMarkdown: string };
  en: { title: string; summary: string; bodyMarkdown: string };
}

export const ACCESS_PRIORITY_BATCHES: ReadonlyArray<{
  fileName: string;
  articles: AccessPriorityArticle[];
}> = [
${batches}
];

export const ACCESS_PRIORITY_SOURCE_ARTICLES = ACCESS_PRIORITY_BATCHES.flatMap((batch) => batch.articles);
`;

await writeFile(outputPath, output, "utf8");
console.log(`Generated Hubpedia access manifest for ${fileNames.length} batches.`);
