import { extractHtml } from "../lib/encyclopedia/extract";
import { FACTORY_RESEARCH_FETCH, chunkResearchText } from "../lib/encyclopedia/factory-research";
import { fetchSource } from "../lib/encyclopedia/fetcher";
import { sourceText } from "../lib/encyclopedia/source-text";

/*
 * Does a candidate source survive extraction? Judge a research plan's sources
 * before spending a run on them: the first sourced article listed two sources
 * and used one, because Readability had reduced the second page to its
 * "About" boilerplate. Reading the page in a browser does not reveal that —
 * only the pipeline's own fetch and extract do, which is what this runs.
 *
 * A source that yields too little text cannot carry claims, and a topic whose
 * sources are thin will be stopped later by the evidence floor anyway.
 */

const SUBSTANTIAL_CHARACTERS = 1_500;
const USABLE_CHARACTERS = 600;

async function probe(url: string) {
  try {
    const fetched = await fetchSource(url, FACTORY_RESEARCH_FETCH);
    const text = sourceText(fetched);
    return {
      url,
      ok: true as const,
      characters: text.replace(/\s+/gu, "").length,
      chunks: chunkResearchText({ url, title: url }, text).length,
      head: text.replace(/\s+/gu, " ").trim().slice(0, 90),
    };
  } catch (error) {
    return { url, ok: false as const, error: error instanceof Error ? error.message.slice(0, 90) : "failed" };
  }
}

async function main() {
  const urls = process.argv.slice(2).filter((argument) => argument.startsWith("http"));
  if (!urls.length) throw new Error("Usage: npm run probe:sources -- <url> [...url]");

  const results = await Promise.all(urls.map(probe));
  results.sort((left, right) => (right.ok ? right.characters : -1) - (left.ok ? left.characters : -1));

  let usable = 0;
  for (const result of results) {
    if (!result.ok) {
      console.log(`  ✗ ${result.url}\n     ${result.error}`);
      continue;
    }
    if (result.characters >= USABLE_CHARACTERS) usable += 1;
    const verdict = result.characters >= SUBSTANTIAL_CHARACTERS ? "◎" : result.characters >= USABLE_CHARACTERS ? "○" : "✗ thin";
    console.log(`  ${verdict} ${result.characters} chars / ${result.chunks} chunks — ${result.url}\n     ${result.head}`);
  }
  console.log(JSON.stringify({ probed: results.length, usable, unusable: results.length - usable }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Source probe failed.");
  process.exitCode = 1;
});
