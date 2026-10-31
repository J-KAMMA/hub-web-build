export type ArticleEntityType =
  | "person"
  | "history"
  | "technology"
  | "idea"
  | "organism"
  | "place"
  | "science"
  | "culture"
  | "general";

type StructureSubject = { title?: string; name?: string; topicType?: string; type?: string; categoryLabel?: string; description?: string | null };

export type ArticleStructureIssue = {
  code: "too_few_sections" | "duplicate_heading" | "misplaced_housekeeping" | "repeated_internal_link" | "missing_chronology" | "missing_uncertainty";
  severity: "blocker" | "warning";
  detail: string;
};

const profiles: Record<ArticleEntityType, string[]> = {
  person: ["identity and reliable biographical record", "life and chronology", "principal activities or works", "reception, influence, and disputed attribution"],
  history: ["scope, period, and setting", "causes and background", "chronological development", "consequences", "evidence and competing interpretations"],
  technology: ["purpose and scope", "components or mechanism", "actual uses", "failure modes, safety, and limitations", "standards or social effects where relevant"],
  idea: ["definition and boundaries", "historical formation", "major schools or variants", "institutional consequences", "criticism and current disputes"],
  organism: ["classification and distribution", "form and physiology", "behavior and ecology", "relationship with ecosystems or people", "threats and conservation status"],
  place: ["location and identity", "historical development", "physical or institutional structure", "functions and significance", "current issues and interpretation"],
  science: ["object of study", "core concepts or mechanism", "evidence and methods", "applications", "limitations, uncertainty, and open questions"],
  culture: ["definition and distinguishing features", "origin and development", "forms, techniques, or practice", "regional and social variation", "reception and contemporary change"],
  general: ["clear identification", "stable basic facts", "subject-specific structure or chronology", "effects and relationships", "material limitations or uncertainty"],
};

export function inferArticleEntityType(subject: StructureSubject): ArticleEntityType {
  const text = `${subject.title ?? subject.name ?? ""} ${subject.topicType ?? subject.type ?? ""} ${subject.categoryLabel ?? ""} ${subject.description ?? ""}`.normalize("NFKC").toLocaleLowerCase("ja");
  if (/(人物|伝記|俳優|作家|詩人|政治家|person|biograph)/u.test(text)) return "person";
  if (/(生物|動物|植物|昆虫|魚類|哺乳|organism|species|wildlife)/u.test(text)) return "organism";
  if (/(技術|コンピュー|ソフトウェア|工学|technology|software|protocol)/u.test(text)) return "technology";
  if (/(思想|哲学|政治思想|主義|ideology|philosophy|political-thought)/u.test(text)) return "idea";
  if (/(科学|物理|化学|数学|天文|遺伝|science|astronomy|biology)/u.test(text)) return "science";
  if (/(歴史|革命|戦争|時代|古代|history|historical)/u.test(text)) return "history";
  if (/(地域|都市|国|美術館|博物館|地理|place|museum|geography)/u.test(text)) return "place";
  if (/(文化|料理|音楽|映画|文学|芸術|culture|food|music|literature)/u.test(text)) return "culture";
  return "general";
}

export function createArticleStructureInstruction(subject: StructureSubject) {
  const entityType = inferArticleEntityType(subject);
  return `Treat the subject as entity type ${entityType}. Select descriptive sections according to the evidence, using these coverage checks rather than fixed headings: ${profiles[entityType].join("; ")}. Do not create an empty section merely to satisfy a check.`;
}

export function auditArticleStructure(subject: StructureSubject & { bodyMarkdown: string }): ArticleStructureIssue[] {
  const headings = [...subject.bodyMarkdown.matchAll(/^##\s+(.+)$/gmu)].map((match) => match[1].trim());
  const issues: ArticleStructureIssue[] = [];
  if (headings.length < 3) issues.push({ code: "too_few_sections", severity: "blocker", detail: "A full article needs at least three substantive sections." });
  const normalized = headings.map((heading) => heading.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLocaleLowerCase("ja"));
  if (new Set(normalized).size !== normalized.length) issues.push({ code: "duplicate_heading", severity: "blocker", detail: "Section headings must not repeat." });
  if (headings.slice(0, 2).some((heading) => /^(関連記事|関連項目|出典|参考文献|related articles|see also|sources|references)$/iu.test(heading))) {
    issues.push({ code: "misplaced_housekeeping", severity: "blocker", detail: "Related links and sources belong after substantive explanation." });
  }
  const targets = [...subject.bodyMarkdown.matchAll(/\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g)].map((match) => match[1]);
  if (new Set(targets).size !== targets.length) issues.push({ code: "repeated_internal_link", severity: "warning", detail: "Link each related article only at its first useful occurrence." });
  const entityType = inferArticleEntityType(subject);
  const headingText = headings.join(" ");
  if ((entityType === "person" || entityType === "history") && !/(生涯|経歴|歴史|時代|時期|変遷|形成|起源|転換|発展|chronolog|history|life|career|period|origin|development|transition)/iu.test(headingText)) {
    issues.push({ code: "missing_chronology", severity: "warning", detail: "This entity type normally needs a chronological section." });
  }
  if (["idea", "science", "technology"].includes(entityType) && !/(論争|批判|不確実|未解決|限界|課題|安全|倫理|controvers|critic|uncertain|open question|limit|safety|ethic)/iu.test(`${headingText} ${subject.bodyMarkdown}`)) {
    issues.push({ code: "missing_uncertainty", severity: "warning", detail: "Separate established explanation from material limitations or uncertainty." });
  }
  return issues;
}
