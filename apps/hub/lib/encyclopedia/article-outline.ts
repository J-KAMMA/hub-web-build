export type ArticleOutlineItem = {
  id: string;
  level: 2 | 3;
  title: string;
};

function plainHeadingText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

export function getArticleOutline(markdown: string): ArticleOutlineItem[] {
  const items: ArticleOutlineItem[] = [];
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!match) continue;
    items.push({
      id: `section-${items.length + 1}`,
      level: match[1].length as 2 | 3,
      title: plainHeadingText(match[2]),
    });
  }
  return items;
}

export function estimateArticleReadingMinutes(markdown: string, locale = "ja") {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https:\/\/\S+/g, "")
    .replace(/[*_`~>-]/g, " ")
    .trim();
  if (!text) return 1;

  if (locale === "ja") {
    return Math.max(1, Math.ceil(text.replace(/\s/g, "").length / 500));
  }
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 220));
}
