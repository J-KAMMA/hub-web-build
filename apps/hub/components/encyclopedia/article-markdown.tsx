import React, { Fragment, type ReactNode } from "react";

import { getArticleOutline } from "@/lib/encyclopedia/article-outline";
import { numberOutline, toWikipediaArticleView } from "@/lib/encyclopedia/wikipedia-view";

type ArticleMarkdownProps = {
  markdown: string;
  locale?: string;
  articleLinks?: Array<{ slug: string; title: string }>;
  inlineAd?: ReactNode;
};

const internalArticlePath = /^\/hubpedia\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const inlineToken = /\[([^\]\n]+)\]\(([^)\s]+)\)|\\?\[(\d+)\\?\]/g;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createAutoLinker(articleLinks: NonNullable<ArticleMarkdownProps["articleLinks"]>, markdown: string) {
  const explicitSlugs = new Set(
    Array.from(markdown.matchAll(/\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g), (match) => match[1]),
  );
  const targets = Array.from(
    new Map(
      articleLinks
        .filter(({ slug, title }) => title.trim().length >= 2 && !explicitSlugs.has(slug))
        .map((target) => [target.title.trim(), target]),
    ).values(),
  ).sort((a, b) => b.title.length - a.title.length);
  if (targets.length === 0) return (text: string) => [text] as ReactNode[];

  const byTitle = new Map(targets.map((target) => [target.title, target]));
  const matcher = new RegExp(targets.map(({ title }) => escapeRegExp(title)).join("|"), "g");
  const linkedSlugs = new Set(explicitSlugs);

  return (text: string, keyPrefix: string, locale: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    matcher.lastIndex = 0;
    while ((match = matcher.exec(text)) !== null) {
      const target = byTitle.get(match[0]);
      if (!target || linkedSlugs.has(target.slug)) continue;

      const before = text[match.index - 1];
      const after = text[match.index + match[0].length];
      const asciiTerm = /^[A-Za-z0-9][A-Za-z0-9 .+_-]*$/.test(match[0]);
      if (asciiTerm && (before && /[A-Za-z0-9]/.test(before) || after && /[A-Za-z0-9]/.test(after))) continue;

      if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
      const href = `/hubpedia/${target.slug}${locale === "ja" ? "" : `?lang=${encodeURIComponent(locale)}`}`;
      nodes.push(<a href={href} key={`${keyPrefix}-auto-${match.index}`}>{match[0]}</a>);
      linkedSlugs.add(target.slug);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
  };
}

function renderInline(text: string, keyPrefix: string, locale: string, autoLink: ReturnType<typeof createAutoLinker>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  inlineToken.lastIndex = 0;
  while ((match = inlineToken.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(...autoLink(text.slice(cursor, match.index), `${keyPrefix}-${cursor}`, locale));
    }

    const [source, label, href, citationIndex] = match;
    if (citationIndex) {
      nodes.push(
        <sup className="article-markdown__citation" key={`${keyPrefix}-${match.index}`}>
          <a
            aria-label={`${locale === "ja" ? "出典" : "Source"} ${citationIndex}`}
            href={`#source-${citationIndex}`}
          >
            [{citationIndex}]
          </a>
        </sup>,
      );
    } else if (internalArticlePath.test(href)) {
      const localizedHref = locale !== "ja" && /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/.test(locale)
        ? `${href}?lang=${encodeURIComponent(locale)}`
        : href;
      nodes.push(
        <a href={localizedHref} key={`${keyPrefix}-${match.index}`}>
          {label}
        </a>,
      );
    } else if (/^https:\/\//.test(href)) {
      nodes.push(
        <a href={href} key={`${keyPrefix}-${match.index}`} rel="noreferrer" target="_blank">
          {label}
        </a>,
      );
    } else {
      nodes.push(source);
    }
    cursor = match.index + source.length;
  }

  if (cursor < text.length) {
    nodes.push(...autoLink(text.slice(cursor), `${keyPrefix}-${cursor}`, locale));
  }
  return nodes;
}

export function ArticleMarkdown({ markdown: rawMarkdown, locale = "ja", articleLinks = [], inlineAd }: ArticleMarkdownProps) {
  /* Wikipedia-style reading view: the stored first 概要/Overview section is
   * promoted to an unheaded lead, the related section takes its conventional
   * name, and a numbered table of contents is inserted before the first
   * remaining section when the article is long enough to need one. */
  const view = toWikipediaArticleView(rawMarkdown, locale);
  const markdown = view.markdown;
  const blocks: ReactNode[] = [];
  const paragraph: string[] = [];
  const listItems: string[] = [];
  const autoLink = createAutoLinker(articleLinks, markdown);
  const outline = getArticleOutline(markdown);
  let headingIndex = 0;
  let sourceList = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const blockIndex = blocks.length;
    blocks.push(
      <p key={`paragraph-${blockIndex}`}>
        {paragraph.map((line, index) => (
          <Fragment key={`paragraph-${blockIndex}-${index}`}>
            {index > 0 ? "\n" : null}
            {renderInline(line, `paragraph-${blockIndex}-${index}`, locale, autoLink)}
          </Fragment>
        ))}
      </p>,
    );
    paragraph.length = 0;
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const blockIndex = blocks.length;
    blocks.push(
      <ul key={`list-${blockIndex}`}>
        {listItems.map((item, index) => (
          <li id={sourceList ? `source-${index + 1}` : undefined} key={`list-${blockIndex}-${index}`}>
            {renderInline(item, `list-${blockIndex}-${index}`, locale, autoLink)}
          </li>
        ))}
      </ul>,
    );
    listItems.length = 0;
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const listItem = /^-\s+(.+)$/.exec(line);

    if (heading) {
      flushParagraph();
      flushList();
      const blockIndex = blocks.length;
      const outlineItem = outline[headingIndex++];
      const content = renderInline(heading[2], `heading-${blockIndex}`, locale, autoLink);
      sourceList = /^(?:出典|参考文献|Sources|References)$/iu.test(heading[2].trim());
      blocks.push(heading[1].length === 3
        ? <h3 id={outlineItem?.id} key={`heading-${blockIndex}`}>{content}</h3>
        : <h2 id={outlineItem?.id} key={`heading-${blockIndex}`}>{content}</h2>);
    } else if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();

  if (view.showToc) {
    const firstHeadingIndex = blocks.findIndex((block) =>
      React.isValidElement(block) && (block.type === "h2" || block.type === "h3"));
    if (firstHeadingIndex > 0) {
      blocks.splice(firstHeadingIndex, 0, (
        <nav aria-label={locale === "ja" ? "目次" : "Contents"} className="article-markdown__toc" key="article-toc">
          <p className="article-markdown__toc-title">{locale === "ja" ? "目次" : "Contents"}</p>
          <ol>
            {numberOutline(view.toc).map((item) => (
              <li className={`article-markdown__toc-item article-markdown__toc-item--level-${item.level}`} key={item.id}>
                <a href={`#${item.id}`}>
                  <span className="article-markdown__toc-number">{item.number}</span> {item.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ));
    }
  }

  if (inlineAd) {
    const sectionStarts = blocks.reduce<number[]>((indexes, block, index) => {
      if (React.isValidElement(block) && block.type === "h2") indexes.push(index);
      return indexes;
    }, []);
    if (sectionStarts.length >= 2) {
      const insertionIndex = sectionStarts[2] ?? blocks.length;
      blocks.splice(insertionIndex, 0, <div className="hubpedia-article__inline-ad" key="hubpedia-inline-ad">{inlineAd}</div>);
    }
  }

  return <div className="article-markdown">{blocks}</div>;
}
