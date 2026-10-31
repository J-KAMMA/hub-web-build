export const HUBPEDIA_COGNITIVE_RHYTHM_GUIDELINES = [
  "The article's primary job is reference lookup. Preserve an encyclopedia backbone before applying any narrative rhythm: identify the subject, establish basic facts and chronology, explain its structure or characteristics, then cover adaptations, uses, reception, impact, or limitations only when relevant.",
  "Use descriptive, subject-based headings rather than argumentative theses. A heading should name the information a reader can retrieve from the section, not announce the writer's interpretation.",
  "Keep interpretation subordinate to verifiable description. Attribute critical readings, evaluations, influence, intent, and disputed significance to supplied evidence; source-free expansion must not introduce an original thematic thesis.",
  "Vary the reader's cognitive task through subject-grounded observation, a real distinction or unresolved question, an evidence-backed conclusion, and a later re-check or qualification.",
  "Create momentum only from the subject's facts, mechanisms, chronology, tradeoffs, or common inferences. Never invent drama, uncertainty, scenes, quotations, or a narrator's feelings.",
  "Open with a concrete contrast, mechanism, consequence, or misconception when the material supports one. Do not open with an agenda such as 'this article explains' or a list of sections.",
  "Use paragraph cadence deliberately: establish a clear foothold, develop it with fuller explanation, then end on a concise subject-level conclusion when one is warranted.",
  "After two or three dense paragraphs, allow a shorter paragraph only when it fixes a fact, changes the scale of view, or identifies the next genuine distinction.",
  "Alternate concrete evidence or examples with interpretation. Introduce a technical term after the underlying distinction is understandable, not as a substitute for explanation.",
  "Resolve questions and contrasts that the article raises. Do not end sections with progress narration such as 'next we will examine'.",
  "Delete meta-writing that only describes the document, its structure, or the writing technique. Every retained sentence should add information about the subject or clarify the status of a claim.",
  "Apply rhythm locally inside otherwise encyclopedic sections. Do not turn the article's overall structure into an essay, argument, or suspense sequence.",
  "Do not force rhetorical questions, short sentences, first-person confession, or direct address. Encyclopedia neutrality, retrievability, and accuracy take priority over rhythm.",
] as const;

export function createCognitiveRhythmInstruction() {
  return HUBPEDIA_COGNITIVE_RHYTHM_GUIDELINES.join(" ");
}
