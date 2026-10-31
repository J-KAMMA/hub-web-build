import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

const startDate = new Date("2026-07-01T00:00:00Z");
const endDate = new Date("2026-07-15T00:00:00Z");
const outputPath = path.resolve("data/hubpedia-access-backlog-2026-07.json");
const userAgent = "Hubpedia/1.0 (local editorial planning; https://jkamma.com)";

type Candidate = {
  title: string;
  views: number;
  activeDays: number;
  bestRank: number;
};

function normalizedTitle(value: string) {
  return value
    .replaceAll("_", " ")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ja");
}

function apiDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("/");
}

function excludedTitle(title: string) {
  return title === "メインページ"
    || title === "-"
    || /^[^:]+:/.test(title)
    || /^(?:一覧|List of )/.test(title);
}

async function main() {
  const existingTitles = new Set(
    VIEWABLE_SEED_ARTICLES.flatMap((article) => [
      normalizedTitle(article.title),
      ...Object.values(article.translations ?? {}).map((translation) => normalizedTitle(translation.title)),
    ]),
  );
  const totals = new Map<string, Candidate>();

  for (let date = new Date(startDate); date <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
    const datePath = apiDate(date);
    const response = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ja.wikipedia/all-access/${datePath}`, {
      headers: { "user-agent": userAgent },
    });
    if (!response.ok) throw new Error(`Wikimedia pageviews failed for ${datePath}: ${response.status}`);
    const payload = await response.json() as {
      items: Array<{ articles: Array<{ article: string; views: number; rank: number }> }>;
    };
    for (const row of payload.items[0]?.articles ?? []) {
      const title = row.article.replaceAll("_", " ").trim();
      if (excludedTitle(title)) continue;
      const key = normalizedTitle(title);
      const current = totals.get(key) ?? { title, views: 0, activeDays: 0, bestRank: Number.MAX_SAFE_INTEGER };
      current.views += row.views;
      current.activeDays += 1;
      current.bestRank = Math.min(current.bestRank, row.rank);
      totals.set(key, current);
    }
  }

  const candidates = [...totals.entries()]
    .filter(([key, candidate]) => !existingTitles.has(key) && candidate.activeDays >= 3)
    .map(([, candidate]) => candidate)
    .sort((left, right) =>
      right.views - left.views
        || right.activeDays - left.activeDays
        || left.bestRank - right.bestRank
        || left.title.localeCompare(right.title, "ja"),
    )
    .slice(0, 700);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    source: "Wikimedia pageviews",
    project: "ja.wikipedia",
    period: "2026-07-01/2026-07-15",
    existingArticleCount: VIEWABLE_SEED_ARTICLES.length,
    candidateCount: candidates.length,
    candidates,
  }, null, 2)}\n`, "utf8");

  console.log(`Prepared ${candidates.length} access-priority candidates after excluding ${existingTitles.size} localized titles.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
