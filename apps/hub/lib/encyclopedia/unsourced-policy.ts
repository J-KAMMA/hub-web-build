/*
 * When may an article be written without sources?
 *
 * The catalog was rebuilt on 2026-08-28 around evidence, after ~2,000
 * source-free articles were removed. Those were not bad only because they
 * lacked citations — they were thin, repetitive, and prone to talking about
 * their own sourcing — and the factory's structure and quality checks now
 * catch all of that. What no check can replace is the verbatim-quote match:
 * without it, nothing distinguishes a date the model knows from a date it
 * invented.
 *
 * So source-free writing is allowed where the subject is carried by
 * explanation rather than by verifiable particulars, and refused where a
 * fabricated particular would mislead or harm. The decision is made from the
 * subject, before generation, so nothing is spent on an article that cannot
 * be published.
 */

export type UnsourcedDecision =
  | { allowed: true }
  | { allowed: false; reason: string; matched: string };

/* Domains where a confident wrong sentence causes harm rather than mere
 * error. The list mirrors catalog-audit's high-risk check, which already
 * blocks unreviewed articles on these subjects. */
const HARMFUL_IF_WRONG = /(医療|医学|病気|疾患|症状|治療|診断|薬|服用|ワクチン|法律|法令|判例|訴訟|契約|税|投資|金融|証券|保険|年金|選挙|政党|政権|安全|危険|medicine|medical|disease|symptom|treatment|diagnosis|drug|vaccine|\blaw\b|legal|lawsuit|contract|\btax\b|invest|financial|insurance|pension|election|safety|hazard)/iu;

/* Real people, organisations, and products: a fabricated attribute is a
 * statement about someone, and the encyclopedia would be asserting it. */
const NAMED_ENTITY = /(人物|伝記|生涯|氏|社長|大統領|首相|創業|企業|株式会社|会社|製品|ブランド|型番|biography|born|founded|company|corporation|\bInc\b|\bLtd\b|product|brand)/iu;

/* Subjects whose substance is dates, counts, or measurements. Explanation
 * cannot carry these; the particulars are the article. */
const PARTICULARS_DRIVEN = /(\d{3,4}年|\d+世紀|統計|人口|売上|順位|記録|受賞|年表|事件|戦争|条約|census|statistics|population|revenue|ranking|record|award|treaty|\b1\d{3}\b|\b20\d{2}\b)/u;

/** The existing harmful-if-wrong classification (medicine, law, tax, finance, safety...) applied to a bare subject string. */
export function matchHarmfulIfWrong(subject: string): string | null {
  return HARMFUL_IF_WRONG.exec(subject)?.[0] ?? null;
}

export function assessUnsourcedEligibility(subject: {
  title: string;
  summary?: string;
  topicType?: string;
  categoryLabel?: string;
}): UnsourcedDecision {
  const text = [subject.title, subject.summary ?? "", subject.topicType ?? "", subject.categoryLabel ?? ""].join(" ");
  const harmful = HARMFUL_IF_WRONG.exec(text);
  if (harmful) {
    return {
      allowed: false,
      matched: harmful[0],
      reason: "A wrong sentence on this subject misleads someone acting on it; it needs sources.",
    };
  }
  const named = NAMED_ENTITY.exec(text);
  if (named) {
    return {
      allowed: false,
      matched: named[0],
      reason: "The subject is a real person, organisation, or product, and an invented attribute would be an assertion about them.",
    };
  }
  const particulars = PARTICULARS_DRIVEN.exec(text);
  if (particulars) {
    return {
      allowed: false,
      matched: particulars[0],
      reason: "The substance of this subject is dates, counts, or measurements, which explanation cannot stand in for.",
    };
  }
  return { allowed: true };
}

/** The banner an unsourced article must carry, so a reader is never misled. */
export const UNSOURCED_NOTICE = {
  ja: "この記事は出典に基づいていません。概念の説明として書かれたもので、事実関係は確認されていません。",
  en: "This article is not based on sources. It is written as an explanation of a concept, and its factual claims have not been verified.",
} as const;
