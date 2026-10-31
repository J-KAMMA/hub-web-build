export interface SearchField {
  value?: string | null;
  weight: number;
}

export type SearchIntent = {
  preferredGroup: "social" | "media" | "knowledge" | "market" | "services" | null;
  preferredKinds: string[];
};

const SCORE_CACHE_LIMIT = 2048;
const scoreCache = new Map<string, number>();

export function normalizeSearchValue(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/[‐‑‒–—―]/g, "-");
}

const SEARCH_SYNONYMS: Record<string, string[]> = {
  ai: ["人工知能", "生成ai"],
  人工知能: ["ai", "生成ai"],
  仕事: ["求人", "案件", "プロジェクト"],
  求人: ["仕事", "採用"],
  車: ["自動車", "乗り物"],
  自動車: ["車", "乗り物"],
  家: ["住宅", "不動産"],
  住宅: ["家", "不動産"],
  音楽: ["曲", "楽曲"],
  動画: ["映像", "ビデオ"],
};

export function expandedSearchTerms(query: string) {
  const terms = searchTerms(query);
  return [...new Set(terms.flatMap((term) => [term, ...(SEARCH_SYNONYMS[term] ?? [])].map(normalizeSearchValue)))].slice(0, 16);
}

export function searchMatchReason(query: string, fields: Array<SearchField & { label: string }>) {
  const phrase = normalizeSearchValue(query);
  const terms = expandedSearchTerms(query);
  const matched = fields
    .map((field) => ({ ...field, normalized: normalizeSearchValue(field.value ?? "") }))
    .filter((field) => field.normalized && (field.normalized.includes(phrase) || terms.some((term) => field.normalized.includes(term))))
    .sort((left, right) => right.weight - left.weight)[0];
  return matched?.label ?? "関連語";
}

export function searchAlternatives(query: string) {
  const normalized = normalizeSearchValue(query);
  const terms = searchTerms(normalized);
  const alternatives = [
    ...terms.flatMap((term) => SEARCH_SYNONYMS[term] ?? []),
    ...(terms.length > 1 ? terms : []),
    normalized.replace(/(とは|について|おすすめ|最新)$/u, "").trim(),
  ];
  return [...new Set(alternatives.map((item) => item.trim()).filter((item) => item && item !== normalized))].slice(0, 5);
}

export function searchTerms(query: string) {
  return normalizeSearchValue(query)
    .split(/\s+/u)
    .map((term) => term.replace(/^[@#＃]+/u, ""))
    .filter(Boolean)
    .slice(0, 8);
}

function editDistanceWithinOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let differences = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    differences += 1;
    if (differences > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return differences + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

/**
 * Shared matching contract for in-memory catalogs and fallback searches.
 * Exact/substring matching stays primary; a single edit is tolerated only
 * for terms long enough to avoid noisy matches.
 */
export function searchTextMatches(query: string, values: Array<string | null | undefined>) {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const text = normalizeSearchValue(values.filter(Boolean).join(" "));
  const words = text.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
  return terms.every((term) => {
    const candidates = [term, ...(SEARCH_SYNONYMS[term] ?? [])].map(normalizeSearchValue);
    return candidates.some((candidate) => {
      if (text.includes(candidate)) return true;
      if (candidate.length < 4) return false;
      return words.some((word) => Math.abs(word.length - candidate.length) <= 1 && editDistanceWithinOne(word, candidate));
    });
  });
}

export function isWalletAddressQuery(query: string) {
  return /^0x[0-9a-f]{40}$/u.test(normalizeSearchValue(query));
}

export function inferSearchIntent(query: string): SearchIntent {
  const value = normalizeSearchValue(query);
  if (!value) return { preferredGroup: null, preferredKinds: [] };
  if (/^0x[0-9a-f]{40}$/u.test(value)) {
    return { preferredGroup: "services", preferredKinds: ["tokens", "profiles", "posts"] };
  }
  if (/^@[\p{L}\p{N}_.-]+$/u.test(value)) {
    return { preferredGroup: "social", preferredKinds: ["profiles", "posts"] };
  }
  if (/(求人|採用|転職|仕事|案件|業務委託|クラウドソーシング)/u.test(value)) {
    return { preferredGroup: "services", preferredKinds: ["work", "communities", "posts"] };
  }
  if (/(曲|楽曲|歌手|アーティスト|アルバム|音楽|動画|映像)/u.test(value)) {
    return { preferredGroup: "media", preferredKinds: ["music", "videos", "images", "posts"] };
  }
  if (/(価格|値段|購入|通販|商品|レビュー|比較|おすすめ)/u.test(value)) {
    return { preferredGroup: "market", preferredKinds: ["products", "posts", "hubpedia"] };
  }
  if (/(とは|なぜ|どうして|方法|仕組み|教えて|[?？]$)/u.test(value)) {
    return { preferredGroup: "knowledge", preferredKinds: ["hubpedia", "threads", "boards", "posts"] };
  }
  return { preferredGroup: null, preferredKinds: [] };
}

export function scoreSearchFields(query: string, fields: SearchField[]) {
  const phrase = normalizeSearchValue(query);
  if (!phrase) return 0;
  const cacheKey = `${phrase}\u0000${fields.map((field) => `${field.weight}:${normalizeSearchValue(field.value ?? "")}`).join("\u0001")}`;
  const cached = scoreCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const terms = expandedSearchTerms(phrase);

  const score = fields.reduce((total, field) => {
    const text = normalizeSearchValue(field.value ?? "");
    if (!text) return total;
    const words = text.split(/[\s、。，．・/|:：()（）\[\]「」『』]+/u).filter(Boolean);
    let score = 0;
    if (text === phrase) score += 18;
    else if (text.startsWith(phrase)) score += 11;
    else if (text.includes(phrase)) score += 7;

    for (const term of terms) {
      if (words.includes(term)) score += 5;
      else if (words.some((word) => word.startsWith(term))) score += 3;
      else if (text.includes(term)) score += 1;
    }
    return total + score * field.weight;
  }, 0);
  if (scoreCache.size >= SCORE_CACHE_LIMIT) scoreCache.clear();
  scoreCache.set(cacheKey, score);
  return score;
}
