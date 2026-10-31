"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/v2/ui/avatar";
import { V2VideoFollow } from "@/components/v2/v2-video-follow";
import type {
  SearchArticleCard,
  SearchMusicCard,
  SearchTagCard,
  SearchThreadCard,
} from "@/lib/search-extras";

/*
 * Result cards for the v2 search page (2026-10-28). One card per result, by kind.
 * Each card has one primary link (class v2-search__hit) so the "back to the same row"
 * behaviour of the page keeps working; the follow button sits beside it, never inside it.
 * Colors are semantic tokens only (app/v2/v2-social.css, "検索の札").
 */

export type SearchPersonDetail = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
};

export type SearchHubpediaDetail = {
  slug: string;
  title: string;
  category: string;
  summary: string;
};

export type SearchVideoDetail = {
  id: string;
  title: string;
  channel: string;
  category: string;
  thumbnailUrl: string | null;
  gated: boolean;
};

type Navigate = (href: string) => void;

function Cover({ url, ratio = "16 / 9", label }: { url: string | null | undefined; ratio?: string; label?: string }) {
  if (!url) {
    return <span className="v2-search-card__cover v2-search-card__cover--empty" style={{ aspectRatio: ratio }} aria-hidden="true">{label ?? ""}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external covers are not optimised.
    <img className="v2-search-card__cover" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ aspectRatio: ratio }} />
  );
}

function Card({ kind, children }: { kind: string; children: ReactNode }) {
  return <article className={`v2-search-card v2-search-card--${kind}`}>{children}</article>;
}

export function SearchPersonCard({
  person,
  href,
  viewerId,
  following,
  japanese,
  onNavigate,
}: {
  person: SearchPersonDetail;
  href: string;
  viewerId: string;
  following: boolean;
  japanese: boolean;
  onNavigate: Navigate;
}) {
  return (
    <Card kind="person">
      <Link className="v2-search__hit v2-search-card__main v2-search-card__main--person" href={href} onClick={() => onNavigate(href)}>
        <Avatar name={person.displayName} src={person.avatarUrl} size={48} />
        <span className="v2-search-card__body">
          <span className="v2-search-card__title">{person.displayName}</span>
          <span className="v2-search-card__meta">@{person.handle}</span>
          {person.bio ? <span className="v2-search-card__excerpt">{person.bio}</span> : null}
        </span>
      </Link>
      {person.id !== viewerId ? (
        <span className="v2-search-card__action">
          <V2VideoFollow
            target={{ kind: "profile", profileId: person.id }}
            initialFollowing={following}
            authenticated={Boolean(viewerId)}
            locale={japanese ? "ja" : "en"}
          />
        </span>
      ) : null}
    </Card>
  );
}

export function SearchArticleResult({ article, japanese, onNavigate }: { article: SearchArticleCard; japanese: boolean; onNavigate: Navigate }) {
  return (
    <Card kind="article">
      <Link className="v2-search__hit v2-search-card__main v2-search-card__main--media" href={article.href} onClick={() => onNavigate(article.href)}>
        <span className="v2-search-card__body">
          <span className="v2-search-card__kind">{japanese ? "記事" : "Article"}</span>
          <span className="v2-search-card__title">{article.title}</span>
          <span className="v2-search-card__meta">{article.author}</span>
          {article.summary ? <span className="v2-search-card__excerpt">{article.summary}</span> : null}
        </span>
        {article.thumbnailUrl ? <Cover url={article.thumbnailUrl} ratio="4 / 3" /> : null}
      </Link>
    </Card>
  );
}

export function SearchVideoResult({ video, href, japanese, onNavigate }: { video: SearchVideoDetail; href: string; japanese: boolean; onNavigate: Navigate }) {
  return (
    <Card kind="video">
      <Link className="v2-search__hit v2-search-card__main v2-search-card__main--media" href={href} onClick={() => onNavigate(href)}>
        <span className="v2-search-card__body">
          <span className="v2-search-card__kind">{japanese ? "動画" : "Video"}</span>
          <span className="v2-search-card__title">{video.title}</span>
          <span className="v2-search-card__meta">{video.channel}</span>
          {video.gated ? <span className="v2-search-card__lock">{japanese ? "鍵つき" : "Locked"}</span> : null}
        </span>
        {!video.gated && video.thumbnailUrl ? <Cover url={video.thumbnailUrl} /> : null}
      </Link>
    </Card>
  );
}

export function SearchMusicResult({ work, japanese, onNavigate }: { work: SearchMusicCard; japanese: boolean; onNavigate: Navigate }) {
  return (
    <Card kind="music">
      <Link className="v2-search__hit v2-search-card__main v2-search-card__main--music" href={work.href} onClick={() => onNavigate(work.href)}>
        <Cover url={work.artworkUrl} ratio="1 / 1" label="♪" />
        <span className="v2-search-card__body">
          <span className="v2-search-card__kind">{japanese ? "音楽" : "Music"}</span>
          <span className="v2-search-card__title">{work.title}</span>
          <span className="v2-search-card__meta">{[work.artist, work.genre, work.year].filter(Boolean).join(" · ")}</span>
        </span>
      </Link>
    </Card>
  );
}

export function SearchHubpediaResult({ article, href, onNavigate }: { article: SearchHubpediaDetail; href: string; onNavigate: Navigate }) {
  return (
    <Card kind="hubpedia">
      <Link className="v2-search__hit v2-search-card__main" href={href} onClick={() => onNavigate(href)}>
        <span className="v2-search-card__body">
          <span className="v2-search-card__kind">Hubpedia{article.category ? ` · ${article.category}` : ""}</span>
          <span className="v2-search-card__title">{article.title}</span>
          {article.summary ? <span className="v2-search-card__excerpt">{article.summary}</span> : null}
        </span>
      </Link>
    </Card>
  );
}

export function SearchThreadResult({ thread, japanese, onNavigate }: { thread: SearchThreadCard; japanese: boolean; onNavigate: Navigate }) {
  return (
    <Card kind="thread">
      <Link className="v2-search__hit v2-search-card__main" href={thread.href} onClick={() => onNavigate(thread.href)}>
        <span className="v2-search-card__body">
          <span className="v2-search-card__kind">{japanese ? "スレッド" : "Thread"}</span>
          <span className="v2-search-card__title">{thread.title}</span>
          <span className="v2-search-card__meta">
            {thread.boardKey} · {japanese ? `${thread.postCount} 件の投稿` : `${thread.postCount} posts`}
          </span>
        </span>
      </Link>
    </Card>
  );
}

export function SearchTagResult({ tag, japanese, onNavigate }: { tag: SearchTagCard; japanese: boolean; onNavigate: Navigate }) {
  const href = `/v2/tag/${encodeURIComponent(tag.name)}`;
  return (
    <Card kind="tag">
      <Link className="v2-search__hit v2-search-card__main" href={href} onClick={() => onNavigate(href)}>
        <span className="v2-search-card__body">
          <span className="v2-search-card__title">#{tag.name}</span>
          {/* 数えているのは投稿のタグだけ。記事のタグは入らないので、0 件なら数を出さない。 */}
          {tag.useCount > 0 ? <span className="v2-search-card__meta">{japanese ? `投稿 ${tag.useCount} 件で使われています` : `Used in ${tag.useCount} posts`}</span> : null}
        </span>
      </Link>
    </Card>
  );
}

/* Kinds with no richer card yet (communities, boards, lists, tokens, work): the kind label and the title. */
/* 掲示板・公開リストなど、応答に補足が載らない種類も、ほかと同じ札の形で出す。 */
export function SearchKindResult({ kindLabel, title, href, onNavigate }: { kindLabel: string; title: string; href: string; onNavigate: Navigate }) {
  return (
    <Card kind="plain">
      <Link className="v2-search__hit v2-search-card__main" href={href} onClick={() => onNavigate(href)}>
        <span className="v2-search-card__body">
          <span className="v2-search-card__kind">{kindLabel}</span>
          <span className="v2-search-card__title">{title}</span>
        </span>
      </Link>
    </Card>
  );
}
