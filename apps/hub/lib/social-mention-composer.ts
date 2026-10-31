export type ActiveSocialMention = {
  start: number;
  end: number;
  query: string;
};

const HANDLE_CHARACTER = /[a-z0-9_]/i;
const MENTION_BOUNDARY_CHARACTER = /[\p{L}\p{N}._%+-]/u;

export function activeSocialMention(text: string, caret: number): ActiveSocialMention | null {
  const safeCaret = Math.max(0, Math.min(text.length, caret));
  let start = safeCaret;
  while (start > 0 && HANDLE_CHARACTER.test(text[start - 1] ?? "")) start -= 1;
  if (start === 0 || text[start - 1] !== "@") return null;

  const mentionStart = start - 1;
  const previous = mentionStart > 0 ? text[mentionStart - 1] ?? "" : "";
  if (previous && MENTION_BOUNDARY_CHARACTER.test(previous)) return null;

  const query = text.slice(start, safeCaret);
  if (query.length > 32 || !/^[a-z0-9_]*$/i.test(query)) return null;

  let end = safeCaret;
  while (end < text.length && HANDLE_CHARACTER.test(text[end] ?? "") && end - start < 32) end += 1;
  return { start: mentionStart, end, query };
}

export function replaceActiveSocialMention(
  text: string,
  active: ActiveSocialMention,
  handle: string,
) {
  const normalizedHandle = handle.replace(/^@/, "").slice(0, 32);
  const replacement = `@${normalizedHandle} `;
  return {
    text: `${text.slice(0, active.start)}${replacement}${text.slice(active.end)}`,
    caret: active.start + replacement.length,
  };
}
