/**
 * 読了時間。日本語は1分あたり約550字、英語は1分あたり約220語で読むと見なす。
 * 本文に混ざる両方を別々に数えて足す。記号と空白は数えない。
 * 純粋な関数だけを置く。サーバーでもクライアントでも読める。
 */

export const READING_CHARS_PER_MINUTE = 550;
export const READING_WORDS_PER_MINUTE = 220;

/* かな・漢字・全角の記号以外の文字（ハングル等を除く）。ここでは日本語の字として数える。 */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/gu;
const LATIN_WORD = /[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/gu;

export type ReadingStats = { characters: number; words: number; minutes: number };

/** 先に Markdown 風の記号を落とす。画像・リンクの URL は読まれないので数えない。 */
function stripMarkup(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/^\s*(?:#{1,6}|>|-)\s+/gmu, "");
}

export function readingStats(text: string): ReadingStats {
  const cleaned = stripMarkup(text ?? "");
  const characters = (cleaned.match(CJK) ?? []).length;
  const words = (cleaned.replace(CJK, " ").match(LATIN_WORD) ?? []).length;
  if (characters === 0 && words === 0) return { characters, words, minutes: 0 };
  const minutes = Math.max(1, Math.ceil(characters / READING_CHARS_PER_MINUTE + words / READING_WORDS_PER_MINUTE));
  return { characters, words, minutes };
}

/** 分。本文が空なら 0。 */
export function readingMinutes(text: string): number {
  return readingStats(text).minutes;
}

export function readingTimeLabel(minutes: number, japanese: boolean): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return japanese ? `約${minutes}分で読めます` : `${minutes} min read`;
}
