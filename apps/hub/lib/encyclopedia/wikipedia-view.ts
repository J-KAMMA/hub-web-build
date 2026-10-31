import { getArticleOutline, type ArticleOutlineItem } from "./article-outline";

/*
 * Wikipedia-style reading view, decided 2026-08-28: the article opens with an
 * unheaded lead (the first 概要/Overview section, promoted), a numbered table
 * of contents follows when the article is long enough to need one, and the
 * closing related-links section carries Wikipedia's conventional name. The
 * stored markdown keeps its explicit 概要 section — generation, audits, and
 * translation all reason about that shape — and this module reshapes it at
 * the reading surface only.
 */

export interface WikipediaArticleView {
  markdown: string;
  toc: ArticleOutlineItem[];
  showToc: boolean;
}

/* Headings whose section is the article's opening statement rather than a
 * topic of its own. Wikipedia has no such section: the lead is unheaded. */
const LEAD_HEADINGS = /^(?:概要|要約|定義|序論|はじめに|overview|summary|definition|introduction)$/iu;
const SEE_ALSO_RENAMES: ReadonlyArray<[RegExp, string, string]> = [
  [/^関連記事$/u, "関連項目", "ja"],
  [/^related articles?$/iu, "See also", "en"],
];

const MINIMUM_TOC_SECTIONS = 3;

export function toWikipediaArticleView(markdown: string, locale = "ja"): WikipediaArticleView {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let sectionIndex = 0;
  for (const line of lines) {
    const heading = /^(#{2})\s+(.+)$/.exec(line);
    if (heading) {
      sectionIndex += 1;
      const text = heading[2].trim();
      if (sectionIndex === 1 && LEAD_HEADINGS.test(text)) {
        /* The first overview section becomes the unheaded lead. */
        continue;
      }
      const rename = SEE_ALSO_RENAMES.find(([pattern, , renameLocale]) =>
        pattern.test(text) && (renameLocale === "ja" ? locale === "ja" : locale !== "ja"));
      if (rename) {
        output.push(`## ${rename[1]}`);
        continue;
      }
    }
    output.push(line);
  }
  const reshaped = output.join("\n").replace(/^\n+/, "");
  const toc = getArticleOutline(reshaped);
  return {
    markdown: reshaped,
    toc,
    showToc: toc.filter((item) => item.level === 2).length >= MINIMUM_TOC_SECTIONS,
  };
}

/* Wikipedia-style numbering: 1, 1.1, 2 ... derived from heading levels. */
export function numberOutline(toc: readonly ArticleOutlineItem[]) {
  let major = 0;
  let minor = 0;
  return toc.map((item) => {
    if (item.level === 2) {
      major += 1;
      minor = 0;
      return { ...item, number: String(major) };
    }
    minor += 1;
    return { ...item, number: `${Math.max(major, 1)}.${minor}` };
  });
}
