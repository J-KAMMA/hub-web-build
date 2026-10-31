const MENTION_PATTERN = /@([a-z0-9_]{1,32})/giu;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const HANDLE_PREFIX_PATTERN = /[\p{L}\p{N}._%+-]/u;

export function extractSocialMentionHandles(text: string, limit = 10): string[] {
  const normalizedLimit = Math.max(0, Math.min(20, Math.trunc(limit)));
  if (!normalizedLimit) return [];
  const urlRanges = [...text.matchAll(URL_PATTERN)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const handles = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (urlRanges.some((range) => index >= range.start && index < range.end)) continue;
    const previous = index > 0 ? text[index - 1] : "";
    if (previous && HANDLE_PREFIX_PATTERN.test(previous)) continue;
    handles.add(match[1].toLocaleLowerCase("en-US"));
    if (handles.size >= normalizedLimit) break;
  }
  return [...handles];
}
