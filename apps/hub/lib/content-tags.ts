import { TAG_MAX_LENGTH, TAG_MAX_PER_ITEM, normalizeTag, normalizeTagList } from "@jkamma/content-tags";

/*
 * Thin Hub adapter over @jkamma/content-tags (2026-10-29): one normaliser for every surface.
 * 8 tags per item, 32 characters per tag, separators = whitespace , 、 ，; "・" belongs to a tag.
 */
export const CONTENT_TAG_LIMIT = TAG_MAX_PER_ITEM;
export const CONTENT_TAG_LENGTH_LIMIT = TAG_MAX_LENGTH;

const HASHTAG_PATTERN = /(^|[\s([{（［｛「『])#([\p{L}\p{N}_ー・]{1,40})/gu;

/** Display form of one tag, or "" when it is not a valid tag. */
export function normalizeContentTag(value: string): string {
  return normalizeTag(value)?.display ?? "";
}

/** Matching key of one tag, or "" when it is not a valid tag. */
export function contentTagKey(value: string): string {
  return normalizeTag(value)?.key ?? "";
}

export function normalizeContentTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return normalizeTagList(input).map((tag) => tag.display);
}

export function extractContentTags(text: string): string[] {
  return normalizeContentTags([...text.matchAll(HASHTAG_PATTERN)].map((match) => match[2]));
}

export function parseContentTagInput(value: string): string[] {
  return normalizeTagList(value).map((tag) => tag.display);
}

export function validateContentTags(input: unknown): string | null {
  if (input === undefined) return null;
  if (!Array.isArray(input)) return "タグの形式が正しくありません。";
  if (input.length > CONTENT_TAG_LIMIT) return `タグは${CONTENT_TAG_LIMIT}個までです。`;
  for (const item of input) {
    if (typeof item !== "string") return "タグの形式が正しくありません。";
    if (!normalizeTag(item)) return `タグは1個${CONTENT_TAG_LENGTH_LIMIT}文字以内で、空白や区切り文字を含めずに入力してください。`;
  }
  return null;
}
