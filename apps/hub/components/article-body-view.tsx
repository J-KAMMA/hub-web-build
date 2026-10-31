import React from "react";
import { articleBlocks, type ArticleInline } from "@/lib/article-body";
import { ArticleYouTubeEmbed } from "@/components/article-youtube-embed";

/** 利用者の書いた外部リンクの rel。検索エンジンに評価を渡さず、opener も渡さない。 */
export const ARTICLE_LINK_REL = "noopener noreferrer nofollow ugc";

function renderInline(nodes: ArticleInline[]): React.ReactNode[] {
  return nodes.map((node, index) => {
    if (node.t === "text") return node.v;
    if (node.t === "code") return <code key={index}>{node.v}</code>;
    if (node.t === "strong") return <strong key={index}>{renderInline(node.c)}</strong>;
    if (node.t === "em") return <em key={index}>{renderInline(node.c)}</em>;
    return node.external
      ? <a key={index} href={node.href} target="_blank" rel={ARTICLE_LINK_REL} data-external="true">{renderInline(node.c)}</a>
      : <a key={index} href={node.href}>{renderInline(node.c)}</a>;
  });
}

/**
 * 本文の描画。HTMLは注入せず、構造ブロックをReact要素として組み立てる。
 * 執筆画面のプレビューと公開後の記事はこの1か所を共有する。
 * 見出しには目次用の安定した id を振る（articleHeadingList と同じ値）。
 */
export function ArticleBodyView({ body, className }: { body: string; className?: string }) {
  const blocks = articleBlocks(body);
  if (!blocks.length) return null;
  return (
    <div className={className ?? "hub-article-body"}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return block.level === 2
              ? <h2 key={index} id={block.id}>{renderInline(block.inline)}</h2>
              : <h3 key={index} id={block.id}>{renderInline(block.inline)}</h3>;
          case "quote":
            return <blockquote key={index}>{renderInline(block.inline)}</blockquote>;
          case "list": {
            const items = block.itemsInline.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
            return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
          }
          case "code":
            return <pre key={index}><code data-lang={block.lang || undefined}>{block.text}</code></pre>;
          case "hr":
            return <hr key={index} />;
          case "image":
            return (
              <figure key={index} className="hub-article-figure">
                {/* eslint-disable-next-line @next/next/no-img-element -- 記事本文の画像は著者が指定したURLで、最適化の対象にしない。 */}
                <img src={block.src} alt={block.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ maxWidth: "100%", height: "auto" }} />
                {block.alt ? <figcaption>{block.alt}</figcaption> : null}
              </figure>
            );
          case "embed":
            return <ArticleYouTubeEmbed key={index} videoId={block.id} />;
          default:
            return <p key={index}>{renderInline(block.inline)}</p>;
        }
      })}
    </div>
  );
}
