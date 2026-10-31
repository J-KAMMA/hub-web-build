import {
  isThreadLanguage,
  isThreadRegion,
  type ThreadLanguage,
  type ThreadRegion,
} from "@/lib/thread-scope";

export const THREAD_SCOPE_LANGUAGE_LIMIT = 5;

export function normalizeAllowedThreadLanguages(value: unknown, fallback: ThreadLanguage): ThreadLanguage[] {
  const values = (Array.isArray(value) ? value : [])
    .filter(isThreadLanguage)
    .filter((language, index, all) => all.indexOf(language) === index)
    .slice(0, THREAD_SCOPE_LANGUAGE_LIMIT);
  return values.includes(fallback) ? values : [fallback, ...values].slice(0, THREAD_SCOPE_LANGUAGE_LIMIT);
}

export function parseStoredThreadLanguages(value: string | null | undefined, fallback: ThreadLanguage): ThreadLanguage[] {
  try {
    return normalizeAllowedThreadLanguages(JSON.parse(value ?? "[]"), fallback);
  } catch {
    return [fallback];
  }
}

export function validateThreadReplyScope(input: {
  body: string;
  declaredLanguage: unknown;
  declaredRegion: unknown;
  allowedLanguages: ThreadLanguage[];
  targetRegion: ThreadRegion;
}): string | null {
  if (!isThreadLanguage(input.declaredLanguage)) return "投稿に使う言語を選んでください。";
  if (!isThreadRegion(input.declaredRegion)) return "投稿内容の対象地域を選んでください。";
  if (!input.allowedLanguages.includes(input.declaredLanguage)) return "このスレッドでは選択した言語を使用できません。";
  if (input.targetRegion !== "global" && input.declaredRegion !== input.targetRegion) {
    return "このスレッドの対象地域外の内容は投稿できません。";
  }
  const detected = detectThreadTextLanguage(input.body);
  if (detected?.confident && detected.language !== input.declaredLanguage && !looksLikeDetectionException(input.body)) {
    return "本文は選択した言語と異なる可能性があります。投稿言語を変更するか、本文を書き直してください。";
  }
  return null;
}

function looksLikeDetectionException(body: string): boolean {
  const letters = [...body].filter((character) => /\p{Letter}/u.test(character)).length;
  return letters < 20 || /https?:\/\/|```|`[^`]+`/u.test(body);
}

export function detectThreadTextLanguage(body: string): { language: ThreadLanguage; confident: boolean } | null {
  const text = body.normalize("NFKC").replace(/https?:\/\/\S+/gu, "");
  const ja = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  const ko = (text.match(/\p{Script=Hangul}/gu) ?? []).length;
  const ar = (text.match(/\p{Script=Arabic}/gu) ?? []).length;
  const hi = (text.match(/\p{Script=Devanagari}/gu) ?? []).length;
  const zh = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  const total = ja + ko + ar + hi + zh + latin;
  if (total < 20) return null;
  if (ja >= 3) return { language: "ja", confident: ja + zh >= total * 0.5 };
  if (ko >= total * 0.5) return { language: "ko", confident: true };
  if (ar >= total * 0.5) return { language: "ar", confident: true };
  if (hi >= total * 0.5) return { language: "hi", confident: true };
  if (zh >= total * 0.6) return { language: "zh-CN", confident: true };
  if (latin >= total * 0.8) return { language: "en", confident: false };
  return null;
}
