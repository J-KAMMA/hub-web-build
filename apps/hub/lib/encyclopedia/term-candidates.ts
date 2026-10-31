export interface CorpusDocument {
  id: string;
  locale: string;
  title: string;
  bodyMarkdown: string;
}

export interface FrequentTermOptions {
  minDocumentFrequency?: number;
  maxResults?: number;
}

export interface FrequentTermCandidate {
  term: string;
  locale: string;
  documentFrequency: number;
  totalFrequency: number;
  documentIds: string[];
  score: number;
}

const ENGLISH_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "do",
  "for", "from", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "may", "more", "not", "of", "on", "or", "our", "she",
  "so", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "those", "to", "was", "we", "were", "what", "when", "where", "which", "who",
  "will", "with", "would", "you", "your",
]);

const JAPANESE_STOPWORDS = new Set([
  "ある", "いる", "する", "なる", "できる", "これ", "それ", "あれ", "ここ", "そこ", "ため",
  "こと", "もの", "よう", "ところ", "そして", "しかし", "また", "など", "から", "まで", "より",
  "について", "として", "による", "により", "です", "ます", "ない", "その", "この", "あの",
]);

type TermStats = {
  totalFrequency: number;
  documentIds: Set<string>;
};

function normalize(value: string, locale: string): string {
  return value.normalize("NFKC").toLocaleLowerCase(locale).trim();
}

function languageOf(locale: string): string {
  return locale.split(/[-_]/, 1)[0]?.toLowerCase() ?? locale.toLowerCase();
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, " $1 ")
    .replace(/<https?:\/\/[^>]+>/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g, " ");
}

function isEligibleTerm(term: string, stopwords: ReadonlySet<string>): boolean {
  return Array.from(term).length > 1 && !/^\p{Number}+$/u.test(term) && !stopwords.has(term);
}

function termsForDocument(document: CorpusDocument): string[] {
  const language = languageOf(document.locale);
  const stopwords = language === "ja" ? JAPANESE_STOPWORDS : language === "en" ? ENGLISH_STOPWORDS : new Set<string>();
  const segmenter = new Intl.Segmenter(document.locale, { granularity: "word" });
  const words = Array.from(segmenter.segment(stripMarkdown(document.bodyMarkdown)))
    .filter((part) => part.isWordLike)
    .map((part) => normalize(part.segment, document.locale));
  const terms = words.filter((word) => isEligibleTerm(word, stopwords));

  if (language !== "ja") return terms;

  const pairs: string[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index];
    const right = words[index + 1];
    if (stopwords.has(left) || stopwords.has(right)) continue;
    const pair = `${left}${right}`;
    if (isEligibleTerm(pair, stopwords)) pairs.push(pair);
  }
  return [...terms, ...pairs];
}

export function extractFrequentTerms(
  documents: readonly CorpusDocument[],
  options: FrequentTermOptions = {},
): FrequentTermCandidate[] {
  const minDocumentFrequency = Math.max(1, Math.floor(options.minDocumentFrequency ?? 3));
  const maxResults = Math.max(0, Math.floor(options.maxResults ?? 50));
  if (maxResults === 0) return [];

  const titlesByLocale = new Map<string, Set<string>>();
  for (const document of documents) {
    const locale = document.locale.toLowerCase();
    const titles = titlesByLocale.get(locale) ?? new Set<string>();
    titles.add(normalize(document.title, document.locale));
    titlesByLocale.set(locale, titles);
  }

  const statsByLocale = new Map<string, Map<string, TermStats>>();
  for (const document of documents) {
    const locale = document.locale.toLowerCase();
    const existingTitles = titlesByLocale.get(locale) ?? new Set<string>();
    const stats = statsByLocale.get(locale) ?? new Map<string, TermStats>();
    const counts = new Map<string, number>();

    for (const term of termsForDocument(document)) {
      if (existingTitles.has(term)) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    for (const [term, count] of counts) {
      const current = stats.get(term) ?? { totalFrequency: 0, documentIds: new Set<string>() };
      current.totalFrequency += count;
      current.documentIds.add(document.id);
      stats.set(term, current);
    }
    statsByLocale.set(locale, stats);
  }

  const candidates: FrequentTermCandidate[] = [];
  for (const [locale, stats] of statsByLocale) {
    for (const [term, value] of stats) {
      const documentFrequency = value.documentIds.size;
      if (documentFrequency < minDocumentFrequency) continue;
      candidates.push({
        term,
        locale,
        documentFrequency,
        totalFrequency: value.totalFrequency,
        documentIds: [...value.documentIds],
        score: documentFrequency * Math.log1p(value.totalFrequency),
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score
      || right.documentFrequency - left.documentFrequency
      || right.totalFrequency - left.totalFrequency
      || left.locale.localeCompare(right.locale)
      || left.term.localeCompare(right.term))
    .slice(0, maxResults);
}
