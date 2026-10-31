type ClaimLike = {
  statement: string;
  knowledgeStatus: string;
};

function plainText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveArticleKeyPoints(markdown: string, claims: readonly ClaimLike[], limit = 5) {
  const supportedClaims = claims
    .filter((claim) => claim.knowledgeStatus !== "refuted" && claim.knowledgeStatus !== "unverified")
    .map((claim) => plainText(claim.statement))
    .filter(Boolean);
  if (supportedClaims.length >= 3) return [...new Set(supportedClaims)].slice(0, limit);

  const bodyWithoutReferences = markdown.replace(/^##\s+(?:関連項目|一次資料|主要文献|出典|参考文献|Related articles|Sources|References)[\s\S]*$/imu, "");
  const paragraphs = bodyWithoutReferences
    .split(/\n{2,}/)
    .filter((block) => !/^#{1,6}\s/.test(block) && !/^\s*[-*]\s/.test(block))
    .map(plainText)
    .filter((text) => text.length >= 30);
  const sentences = paragraphs.flatMap((paragraph) => paragraph.split(/(?<=[。.!?！？])\s*/u));
  return [...new Set(sentences.map(plainText).filter((text) => text.length >= 20))].slice(0, limit);
}
