export interface EditorialInstructionOptions {
  sourceBacked: boolean;
}

export const HUBPEDIA_EDITORIAL_PRINCIPLES = [
  "Write an encyclopedia article, not advocacy, advertising, personal advice, a news feed, or an indiscriminate collection of facts.",
  "Use a neutral voice. Describe significant viewpoints in proportion to the available evidence, attribute disputed positions, and do not manufacture false balance.",
  "Keep factual claims verifiable. Do not turn an inference, prediction, or model output into an established fact.",
  "Do not publish original research or a novel conclusion assembled from unrelated facts.",
  "Use original wording and respect copyright. Never imitate the distinctive wording or structure of a source.",
  "Wikipedia may be used only to discover terminology and underlying references. Never cite Wikipedia as article evidence, copy its prose or outline, or treat it as support for a factual claim; verify claims against the underlying source instead.",
  "Treat citation permission and reuse permission separately. A reviewed citation-only source may support independently written facts, but its prose, tables, diagrams, and images must not be copied, translated, closely paraphrased, or adapted.",
  "Treat these publication policies as mandatory. If a useful article cannot satisfy them, narrow its scope or keep it unpublished instead of making an exception.",
] as const;

export const HUBPEDIA_EDITORIAL_GUIDELINES = [
  "Write plainly, directly, and specifically. Avoid jargon where a standard term is not needed, but do not talk down to the reader.",
  "Be as concise as the subject permits, but no more concise. Remove filler without omitting distinctions, mechanisms, context, or limitations needed to prevent misunderstanding.",
  "State the subject and scope early, keep each section within that scope, and avoid repeating material that belongs in another article.",
  "Use internal links only when they materially help the reader understand the current passage. Do not add links merely to increase link count.",
  "Keep definitions, claims, dates, terminology, and conclusions mutually consistent within the article and across its translations.",
  "Apply these guidelines with subject-specific judgment. A justified exception is allowed when it improves accuracy or comprehension without violating a publication policy.",
] as const;

export function createHubpediaEditorialInstruction(options: EditorialInstructionOptions) {
  const evidenceRule = options.sourceBacked
    ? "Use only the supplied evidence for factual claims. If the evidence does not support a useful statement, omit it or state the uncertainty."
    : "Limit source-free writing to stable, broadly established explanatory knowledge. Omit disputed, rapidly changing, numerical, biographical, legal, medical, financial, or safety-critical claims that require source verification.";

  return [
    ...HUBPEDIA_EDITORIAL_PRINCIPLES,
    evidenceRule,
    ...HUBPEDIA_EDITORIAL_GUIDELINES,
    "Quality is judged by conceptual accuracy, scope, distinctions, mechanisms, and useful limitations, not by character count or a fixed section template.",
  ].join(" ");
}
