/**
 * Placeholder initial for avatars and cover tiles. Leading bracketed tags such as
 * 【見本】 or [WIP] are dropped as a whole, so 「【見本】写真散歩の会」 yields 写
 * (the name), not the tag's first letter. Remaining brackets and punctuation are
 * skipped. When nothing is left after the tag, the tag's own text is used, so a
 * name that is only 「【見本】」 still gets 見. Returns the fallback when nothing
 * letter-like exists.
 */
const LEADING_TAG = /^\s*(?:【[^】]*】|\[[^\]]*\]|［[^］]*］|〔[^〕]*〕|\([^)]*\)|（[^）]*）)\s*/u;

function firstLetter(text: string): string | null {
  for (const char of Array.from(text.trim())) {
    if (/[\p{L}\p{N}]/u.test(char)) return char.toUpperCase();
  }
  return null;
}

export function displayInitial(name: string | null | undefined, fallback = "?"): string {
  const full = (name ?? "").trim();
  let rest = full;
  for (let i = 0; i < 3 && LEADING_TAG.test(rest); i += 1) rest = rest.replace(LEADING_TAG, "");
  return firstLetter(rest) ?? firstLetter(full) ?? fallback;
}
