const relatedSectionHeading = /^##\s+(?:関連記事|関連項目|Related articles|See also)\s*$/imu;

export function removeEmbeddedRelatedSection(markdown: string) {
  const match = relatedSectionHeading.exec(markdown);
  if (!match || match.index === undefined) return markdown.trim();

  const followingHeading = /^##\s+.+$/gmu;
  followingHeading.lastIndex = match.index + match[0].length;
  const next = followingHeading.exec(markdown);
  const before = markdown.slice(0, match.index).trimEnd();
  const after = next ? markdown.slice(next.index).trimStart() : "";
  return [before, after].filter(Boolean).join("\n\n").trim();
}

export function removeEmbeddedSourceSection(markdown: string) {
  const match = /^##\s+(?:出典|参考文献|Sources|References)\s*$/imu.exec(markdown);
  if (!match || match.index === undefined) return markdown.trim();

  const followingHeading = /^##\s+.+$/gmu;
  followingHeading.lastIndex = match.index + match[0].length;
  const next = followingHeading.exec(markdown);
  const before = markdown.slice(0, match.index).trimEnd();
  const after = next ? markdown.slice(next.index).trimStart() : "";
  return [before, after].filter(Boolean).join("\n\n").trim();
}
