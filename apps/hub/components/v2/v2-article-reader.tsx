import Link from "next/link";
import { V2TagChipRow } from "@/components/v2/v2-tag-chip";
import React, { type ReactNode } from "react";

import { FollowToggleButton } from "@/components/follow-toggle-button";
import { readingTimeLabel } from "@/lib/article-reading";

/*
 * 記事を読む画面の枠（レーンA）。本文そのものは children として受ける。
 * 本文の解析と描画は components/article-body-view.tsx の持ち物で、ここは触らない。
 * 色は意味トークンだけ（app/v2/v2-article.css）。
 */

export type ReaderHeading = { id: string; level: 2 | 3; text: string };

export type ReaderAuthor = {
  id: string;
  handle: string | null;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  articleCount: number;
  following: boolean;
};

export type ReaderNeighbour = { id: string; title: string };

/* 目次を出す最小の見出し数。 */
export const READER_TOC_MIN_HEADINGS = 3;

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

export function V2ReaderAvatar({ name, url, size = "sm" }: { name: string; url: string | null; size?: "sm" | "lg" }) {
  const className = `v2-reader__avatar v2-reader__avatar--${size}`;
  return url
    // eslint-disable-next-line @next/next/no-img-element -- 利用者の絵は外部URLもあり、最適化の対象にしない。
    ? <img className={className} src={url} alt="" width={size === "lg" ? 64 : 40} height={size === "lg" ? 64 : 40} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    : <span className={`${className} v2-reader__avatar--placeholder`} aria-hidden="true">{initial(name)}</span>;
}

function TocList({ headings }: { headings: ReaderHeading[] }) {
  return (
    <ol className="v2-reader__toc-list">
      {headings.map((heading) => (
        <li key={heading.id} className={heading.level === 3 ? "v2-reader__toc-item v2-reader__toc-item--sub" : "v2-reader__toc-item"}>
          <a href={`#${heading.id}`}>{heading.text}</a>
        </li>
      ))}
    </ol>
  );
}

export function V2ArticleToc({ headings, japanese }: { headings: ReaderHeading[]; japanese: boolean }) {
  if (headings.length < READER_TOC_MIN_HEADINGS) return null;
  const label = japanese ? "目次" : "Contents";
  return (
    <>
      {/* 狭い幅: 本文の上で折りたたむ。 */}
      <details className="v2-reader__toc v2-reader__toc--fold">
        <summary>{label}<span className="v2-reader__toc-count">{headings.length}</span></summary>
        <TocList headings={headings} />
      </details>
      {/* 広い幅: 本文の脇に固定する。 */}
      <nav className="v2-reader__toc v2-reader__toc--side" aria-label={label}>
        <p className="v2-reader__toc-title">{label}</p>
        <TocList headings={headings} />
      </nav>
    </>
  );
}

export function V2ArticleAuthorCard({
  author,
  viewerId,
  japanese,
}: {
  author: ReaderAuthor;
  viewerId: string | null;
  japanese: boolean;
}) {
  const own = Boolean(viewerId) && viewerId === author.id;
  const profileHref = author.handle ? `/v2/profile/${author.handle}` : null;
  return (
    <aside className="v2-reader__author-card" aria-label={japanese ? "書き手" : "About the author"}>
      <V2ReaderAvatar name={author.displayName} url={author.avatarUrl} size="lg" />
      <div className="v2-reader__author-card-main">
        <p className="v2-reader__author-card-name">
          {profileHref ? <Link href={profileHref}>{author.displayName}</Link> : author.displayName}
        </p>
        {author.handle ? <p className="v2-reader__author-card-handle">@{author.handle}</p> : null}
        {author.bio ? <p className="v2-reader__author-card-bio">{author.bio}</p> : null}
        {author.articleCount > 0 ? (
          <p className="v2-reader__author-card-meta">{japanese ? `記事 ${author.articleCount}本` : `${author.articleCount} articles`}</p>
        ) : null}
      </div>
      <div className="v2-reader__author-card-action">
        {own ? null : viewerId
          ? <FollowToggleButton initiallyFollowing={author.following} targetProfileId={author.id} />
          : profileHref
            ? <Link className="button profile-follow-button" href={`/v2/auth?next=${encodeURIComponent(profileHref)}`}>{japanese ? "ログインしてフォロー" : "Sign in to follow"}</Link>
            : null}
      </div>
    </aside>
  );
}

export function V2ArticleNeighbours({
  previous,
  next,
  japanese,
}: {
  previous: ReaderNeighbour | null;
  next: ReaderNeighbour | null;
  japanese: boolean;
}) {
  if (!previous && !next) return null;
  return (
    <nav className="v2-reader__neighbours" aria-label={japanese ? "同じ書き手の前後の記事" : "More from this author"}>
      {previous
        ? <Link className="v2-reader__neighbour" href={`/v2/articles/${previous.id}`} rel="prev">
            <small>{japanese ? "前の記事" : "Previous"}</small>
            <strong>{previous.title}</strong>
          </Link>
        : <span />}
      {next
        ? <Link className="v2-reader__neighbour v2-reader__neighbour--next" href={`/v2/articles/${next.id}`} rel="next">
            <small>{japanese ? "次の記事" : "Next"}</small>
            <strong>{next.title}</strong>
          </Link>
        : <span />}
    </nav>
  );
}

export function V2ArticleReader({
  title,
  summary,
  coverUrl,
  authorName,
  authorHandle,
  authorAvatarUrl,
  publishedAt,
  publishedLabel,
  updatedLabel,
  minutes,
  tags,
  headings,
  actions,
  author,
  viewerId,
  neighbours,
  japanese,
  children,
  footer,
}: {
  title: string;
  summary?: string;
  coverUrl?: string | null;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  publishedAt: string;
  publishedLabel: string | null;
  updatedLabel?: string | null;
  minutes: number;
  tags: { label: string; href: string }[];
  headings: ReaderHeading[];
  actions?: ReactNode;
  author: ReaderAuthor | null;
  viewerId: string | null;
  neighbours: { previous: ReaderNeighbour | null; next: ReaderNeighbour | null };
  japanese: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const reading = readingTimeLabel(minutes, japanese);
  const hasToc = headings.length >= READER_TOC_MIN_HEADINGS;
  return (
    <div className="v2-reader" data-has-toc={hasToc ? "true" : "false"}>
      <article className="v2-reader__article">
        {coverUrl ? (
          <figure className="v2-reader__cover">
            {/* eslint-disable-next-line @next/next/no-img-element -- 表紙は著者が指定した外部URLで、最適化の対象にしない。 */}
            <img src={coverUrl} alt="" width={1040} height={585} decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
          </figure>
        ) : null}
        <header className="v2-reader__head">
          <h1 className="v2-reader__title ui-title-wrap">{title}</h1>
          {summary ? <p className="v2-reader__summary">{summary}</p> : null}
          <div className="v2-reader__byline-row">
          <div className="v2-reader__byline">
            <V2ReaderAvatar name={authorName} url={authorAvatarUrl} />
            <div className="v2-reader__byline-text">
              <span className="v2-reader__byline-name">
                {authorHandle ? <Link href={`/v2/profile/${authorHandle}`}>{authorName}</Link> : authorName}
                {authorHandle ? <span className="v2-reader__byline-handle">@{authorHandle}</span> : null}
              </span>
              <span className="v2-reader__byline-meta">
                {publishedLabel ? <time dateTime={publishedAt}>{publishedLabel}</time> : null}
                {reading ? <span>{reading}</span> : null}
                {updatedLabel ? <span>{updatedLabel}</span> : null}
              </span>
            </div>
          </div>
          {actions ? <div className="v2-reader__actions">{actions}</div> : null}
          </div>
        </header>

        <div className="v2-reader__layout">
          <div className="v2-reader__main">
            {hasToc ? <V2ArticleToc headings={headings} japanese={japanese} /> : null}
            <div className="v2-reader__content">{children}</div>
            {tags.length ? (
              <V2TagChipRow className="v2-reader__tags" tags={tags.map((tag) => tag.label)} kind="articles" label={japanese ? "タグ" : "Tags"} />
            ) : null}
            {author ? <V2ArticleAuthorCard author={author} viewerId={viewerId} japanese={japanese} /> : null}
            <V2ArticleNeighbours previous={neighbours.previous} next={neighbours.next} japanese={japanese} />
          </div>
        </div>
      </article>
      {footer}
    </div>
  );
}
