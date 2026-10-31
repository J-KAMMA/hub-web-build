import type { ReactNode } from "react";

import { ArticleMarkdown } from "@/components/encyclopedia/article-markdown";
import { getArticleOutline } from "@/lib/encyclopedia/article-outline";

export type ArticleSpoilerScope = {
  sectionKey: string;
  workSlug: string;
  earliestInstallment: string | null;
  originalReleaseAt: string | null;
  disclosureLevel: string;
  summary: string;
};

export function SpoilerAwareArticle({
  markdown,
  locale,
  articleLinks,
  inlineAd,
  scopes,
}: {
  markdown: string;
  locale: string;
  articleLinks: Array<{ slug: string; title: string }>;
  inlineAd?: ReactNode;
  scopes: ArticleSpoilerScope[];
}) {
  if (!scopes.length) {
    return <ArticleMarkdown markdown={markdown} locale={locale} articleLinks={articleLinks} inlineAd={inlineAd} />;
  }
  const scopeBySection = new Map(scopes.map((scope) => [scope.sectionKey, scope]));
  const sections = markdown.split(/(?=^##\s+)/gmu);
  return <div className="hubpedia-spoiler-aware-article">
    {sections.map((section, index) => {
      const sectionKey = getArticleOutline(section)[0]?.id;
      const scope = sectionKey ? scopeBySection.get(sectionKey) : undefined;
      const content = <ArticleMarkdown
        markdown={section}
        locale={locale}
        articleLinks={articleLinks}
        inlineAd={index === 0 ? inlineAd : undefined}
      />;
      if (!scope) return <div key={`${sectionKey ?? "intro"}-${index}`}>{content}</div>;
      return <details className="hubpedia-spoiler-section" key={`${sectionKey}-${index}`}>
        <summary>
          <strong>ネタバレを含む節</strong>
          <span>{scope.earliestInstallment ?? scope.workSlug}{scope.originalReleaseAt ? `・${scope.originalReleaseAt}` : ""}</span>
          <small>{scope.summary}</small>
        </summary>
        {content}
      </details>;
    })}
  </div>;
}
