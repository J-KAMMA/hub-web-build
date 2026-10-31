/*
 * Reading a question against the tags the catalogue already has.
 *
 * Measured on staging before writing this. Asked for 「80年代のロック」 the
 * meaning search returned Sacrifice and Billie Jean (pop, not rock) and Iris
 * (1998) — three of six wrong. Filtering by the exact tags 1980年代 and ロック
 * returned six eighties rock songs and nothing else. The precise answer was
 * there the whole time; the query simply never matched as literal text, so the
 * request fell through to meaning.
 *
 * Kept apart from the server module so it can be exercised directly: a wrong
 * reading here silently narrows every search.
 */

export interface QueryTagCandidate {
  tag: string;
  kind: string;
}

/*
 * 「80年代」 as people write it. Two digits from the sixties on are the last
 * century; anything lower is this one. 2030 is the far edge of anything a
 * catalogue of released music will hold.
 */
function expandDecades(query: string): string[] {
  const found: string[] = [];
  for (const match of query.matchAll(/(\d{2}|\d{4})\s*年代/gu)) {
    const digits = match[1];
    if (digits.length === 4) {
      found.push(`${digits}年代`);
      continue;
    }
    const value = Number(digits);
    found.push(`${value >= 60 ? 1900 + value : 2000 + value}年代`);
  }
  return found;
}

/**
 * The tags a question names, longest first.
 *
 * Matching runs from the question towards the vocabulary — does the question
 * contain this tag? — because the other direction turns 「ロック」 into every
 * tag containing it: ポップロック, オルタナティブ・ロック, ヘヴィロック. A tag
 * that is itself contained in a longer match is dropped for the same reason:
 * 「ポップロックが好き」 names one genre, not three.
 */
export function resolveMusicQueryTags(
  query: string,
  vocabulary: readonly QueryTagCandidate[],
  limit = 4,
): string[] {
  const normalized = query.normalize("NFKC").trim();
  if (!normalized) return [];
  const decades = new Set(expandDecades(normalized));

  const matched = vocabulary
    .filter((candidate) => {
      const tag = candidate.tag.normalize("NFKC");
      if (!tag) return false;
      if (decades.has(tag)) return true;
      /* A single character matches far too much to mean anything. */
      return tag.length >= 2 && normalized.includes(tag);
    })
    .map((candidate) => candidate.tag)
    .sort((left, right) => right.length - left.length);

  const kept: string[] = [];
  for (const tag of matched) {
    if (kept.some((longer) => longer !== tag && longer.includes(tag))) continue;
    if (kept.includes(tag)) continue;
    kept.push(tag);
    if (kept.length >= Math.max(1, limit)) break;
  }
  return kept;
}
