import { explanationRoleForHeading, parseExplanationBlocks, type ExplanationRole } from "./explanation-engine";
import { auditArticleStructure, inferArticleEntityType, type ArticleStructureIssue } from "./article-structure-policy";
import { removeRepeatedTitleFromSummary } from "./summary-display";

export type KnowledgeStatementKind = "fact" | "attributed_interpretation" | "uncertainty";
export type ParagraphEvidence = { section: string; paragraph: number; citations: number[]; sourceUrls: string[]; statementKind: KnowledgeStatementKind };
export type DuplicatePassage = { left: string; right: string; similarity: number };
export type LinkIssue = { targetSlug: string; code: "repeated_target" | "weak_anchor" };

export type ArticleQualityAssessment = {
  entityType: ReturnType<typeof inferArticleEntityType>;
  score: number;
  publishable: boolean;
  evidenceCoverage: number;
  lead: { concise: boolean; identifiesSubject: boolean; repeatsTitle: boolean };
  sectionRoles: Array<{ heading: string; role: ExplanationRole; importance: number }>;
  evidence: ParagraphEvidence[];
  duplicatePassages: DuplicatePassage[];
  linkIssues: LinkIssue[];
  structureIssues: ArticleStructureIssue[];
};

const sentenceAttribution = /(?:によれば|とされる|と論じ|と指摘|という見解|研究者|批評家|according to|argues?|suggests?|critics?)/iu;
const sentenceUncertainty = /(?:不明|不確実|未解決|議論|論争|可能性|推定|見解が分か|明らかでない|uncertain|unknown|unresolved|debated|may|might)/iu;
const citationPattern = /\\?\[(\d+)\\?\]/g;
const sourcePattern = /https?:\/\/[^\s)\]]+/g;

function statementKind(text: string): KnowledgeStatementKind {
  if (sentenceUncertainty.test(text)) return "uncertainty";
  if (sentenceAttribution.test(text)) return "attributed_interpretation";
  return "fact";
}

function tokens(text: string) {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("ja").replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = normalized.split(/\s+/u).filter((word) => word.length >= 2);
  if (words.length >= 4) return new Set(words);
  const compact = normalized.replace(/\s+/g, "");
  return new Set(Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2)));
}

function similarity(left: string, right: string) {
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function roleImportance(role: ExplanationRole) {
  return ({ overview: 0, background: 1, mechanism: 1, detail: 2, example: 3, uncertainty: 4, relations: 5, sources: 6 } satisfies Record<ExplanationRole, number>)[role];
}


/*
 * A lead identifies its subject when it names what kind of thing the subject
 * is. Hunting for 「である」 alone mistook good leads for bad ones: 「太陽系の
 * 中心にある恒星で、…」 and 「…した唯一の惑星でもある」 both name a kind, and
 * both were failed. So this matches the ways Japanese actually classifies —
 * the copula in its several forms, the te-form that continues into the next
 * clause, and the verbs of classification — rather than one spelling of it.
 *
 * The check is deliberately generous. Its purpose is to catch a lead that
 * never says what the subject is, not to enforce a house sentence pattern,
 * and over-accepting costs a reader nothing while over-rejecting pushed
 * writing toward a wooden 「〜である」.
 */
const CLASSIFYING_PREDICATE = /(?:である|であり|であっ|だった|です|を指す|と呼ば|とされ|にあたる|に当たる|に属す|という|の一種|の一つ|の分野|一分野|is |are |was |were |refers to|denotes)/iu;
/* Te-form copula: a noun followed by 「で、」 continues into the next clause,
 * as in 「岩石惑星で、表面の鉄が…」. */
const CLASSIFYING_TE_FORM = /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー]{2,}で[、,]/u;

function identifiesSubjectKind(summary: string) {
  return CLASSIFYING_PREDICATE.test(summary) || CLASSIFYING_TE_FORM.test(summary);
}

export function assessArticleQuality(input: { title: string; summary: string; bodyMarkdown: string; topicType?: string; categoryLabel?: string; sources?: readonly unknown[] }): ArticleQualityAssessment {
  const blocks = parseExplanationBlocks(input.bodyMarkdown);
  const structureIssues = auditArticleStructure(input);
  const cleanedSummary = removeRepeatedTitleFromSummary(input.title, input.summary);
  const lead = {
    concise: cleanedSummary.length >= 35 && cleanedSummary.length <= 320,
    identifiesSubject: cleanedSummary.length >= 20 && identifiesSubjectKind(cleanedSummary),
    repeatsTitle: cleanedSummary !== input.summary.normalize("NFC").trim(),
  };
  const sectionRoles = blocks.map((block) => ({ heading: block.heading, role: explanationRoleForHeading(block.heading), importance: roleImportance(explanationRoleForHeading(block.heading)) }));
  for (let index = 1; index < sectionRoles.length; index += 1) {
    if (sectionRoles[index].importance + 2 < sectionRoles[index - 1].importance) {
      structureIssues.push({ code: "misplaced_housekeeping", severity: "warning", detail: `Move foundational section '${sectionRoles[index].heading}' before later-stage material.` });
      break;
    }
  }
  const evidence: ParagraphEvidence[] = [];
  const passages: Array<{ id: string; text: string }> = [];
  for (const block of blocks) {
    const paragraphs = block.bodyMarkdown.split(/\n\s*\n/u).map((value) => value.trim()).filter(Boolean);
    paragraphs.forEach((text, paragraph) => {
      evidence.push({ section: block.heading, paragraph, citations: [...text.matchAll(citationPattern)].map((match) => Number(match[1])), sourceUrls: [...text.matchAll(sourcePattern)].map((match) => match[0]), statementKind: statementKind(text) });
      if (text.replace(/\s+/g, "").length >= 30) passages.push({ id: `${block.heading}:${paragraph + 1}`, text });
    });
  }
  const duplicatePassages: DuplicatePassage[] = [];
  for (let left = 0; left < passages.length; left += 1) for (let right = left + 1; right < passages.length; right += 1) {
    const score = similarity(passages[left].text, passages[right].text);
    if (score >= 0.72) duplicatePassages.push({ left: passages[left].id, right: passages[right].id, similarity: Number(score.toFixed(2)) });
  }
  const links = [...input.bodyMarkdown.matchAll(/\[([^\]]+)\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g)].map((match) => ({ anchor: match[1], targetSlug: match[2] }));
  const seen = new Set<string>(), linkIssues: LinkIssue[] = [];
  for (const link of links) {
    if (seen.has(link.targetSlug)) linkIssues.push({ targetSlug: link.targetSlug, code: "repeated_target" });
    else seen.add(link.targetSlug);
    if (link.anchor.trim().length < 2 || /^(こちら|詳細|記事|here|more)$/iu.test(link.anchor.trim())) linkIssues.push({ targetSlug: link.targetSlug, code: "weak_anchor" });
  }
  let score = 100;
  if (!lead.concise) score -= 8;
  if (!lead.identifiesSubject) score -= 8;
  score -= structureIssues.filter((issue) => issue.severity === "blocker").length * 20;
  score -= structureIssues.filter((issue) => issue.severity === "warning").length * 5;
  score -= Math.min(20, duplicatePassages.length * 8);
  score -= Math.min(12, linkIssues.length * 3);
  const sourceBacked = (input.sources?.length ?? 0) > 0;
  const evidenceCoverage = evidence.length ? evidence.filter((item) => item.citations.length > 0 || item.sourceUrls.length > 0).length / evidence.length : 0;
  if (sourceBacked && evidence.length > 0 && evidence.every((item) => !item.citations.length && !item.sourceUrls.length)) score -= 15;
  if (sourceBacked && evidenceCoverage < 0.7) score -= Math.round((0.7-evidenceCoverage)*20);
  score = Math.min(95,Math.max(0, score));
  return { entityType: inferArticleEntityType(input), score, publishable: score >= 70 && !structureIssues.some((issue) => issue.severity === "blocker"), evidenceCoverage:Number(evidenceCoverage.toFixed(2)), lead, sectionRoles, evidence, duplicatePassages, linkIssues, structureIssues };
}
