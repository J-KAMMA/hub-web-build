import Link from "next/link";

import { articleBadges, type HubArticleContent } from "@/lib/article-content";

import styles from "./article-content-card.module.css";

function ArticleCardBody({ article }: { article: HubArticleContent }) {
  const badges = articleBadges(article);
  const sourceLabel = article.source === "hubpedia" ? "Hubpedia" : null;
  const showSource = sourceLabel && sourceLabel.toLocaleLowerCase() !== article.author.trim().toLocaleLowerCase();
  return <>
    <span className={styles.copy}>
      <span className={styles.meta}>
        <span>{article.author}</span>
        {showSource ? <span>{sourceLabel}</span> : null}
      </span>
      <h3>{article.title}</h3>
      <p>{article.summary}</p>
    </span>
    <span className={styles.badges} aria-label="記事の利用条件">
      {badges.map((badge) => <span key={badge}>{badge}</span>)}
    </span>
  </>;
}

export function ArticleContentCard({
  article,
  className,
  coverClassName,
  coverUrl,
  onOpen,
}: {
  article: HubArticleContent;
  className?: string;
  coverClassName?: string;
  coverUrl?: string;
  onOpen?: () => void;
}) {
  const cardClassName = [styles.card, className].filter(Boolean).join(" ");
  if (onOpen) {
    return <article
      className={cardClassName}
      role="link"
      tabIndex={0}
      aria-label={`${article.title}を開く`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {coverUrl ? <div className={coverClassName}><img src={coverUrl} alt="" loading="lazy" decoding="async" /></div> : null}
      <ArticleCardBody article={article} />
    </article>;
  }
  return <Link className={cardClassName} href={article.href}>
    <ArticleCardBody article={article} />
  </Link>;
}
