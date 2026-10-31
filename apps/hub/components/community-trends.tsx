"use client";

import React, { useState } from "react";

import { Board, SocialPost, ThreadSummary } from "@/lib/domain";
import type { HubLocale } from "@/lib/i18n";
import { localizedText, type LocalizedText } from "@/lib/localized-text";

type TrendTab = "all" | "topics" | "posts" | "threads" | "communities" | "hubpedia" | "tokens";
type TrendOrder = "rising" | "popular";

interface ThreadTrend {
  thread: ThreadSummary & { recentPostCount?: number; recentParticipantCount?: number };
  board?: Board;
  momentum: number;
}

interface SocialTrend {
  post: SocialPost;
  replyCount: number;
  repostCount?: number;
  likeCount?: number;
  score: number;
}

interface HubpediaTrend {
  slug: string;
  title: string;
  category: string;
  summary: string;
  score: number;
}

interface TokenTrend {
  id: string;
  title: string;
  symbol: string;
  network: string;
  holderCount: number;
  score: number;
}

interface CommunityTrend {
  id: string;
  slug: string;
  name: string;
  category: string;
  memberCount: number;
  recentMemberCount: number;
  score: number;
}

interface TagTrend {
  name: string;
  key: string;
  recentCount: number;
  totalCount: number;
  score: number;
}

interface Props {
  threadRanking: ThreadTrend[];
  socialRanking: SocialTrend[];
  hubpediaRanking: HubpediaTrend[];
  tokenRanking: TokenTrend[];
  communityRanking: CommunityTrend[];
  tagRanking?: TagTrend[];
  locale?: HubLocale;
}

const TAB_LABELS: Record<TrendTab, LocalizedText> = {
  all: { ja: "総合", en: "Overview", ko: "종합", "zh-CN": "综合" },
  topics: { ja: "話題", en: "Topics", ko: "화제", "zh-CN": "话题" },
  posts: { ja: "ポスト", en: "Posts", ko: "게시물", "zh-CN": "帖子" },
  threads: { ja: "スレッド", en: "Threads", ko: "스레드", "zh-CN": "主题" },
  communities: { ja: "コミュニティ", en: "Communities", ko: "커뮤니티", "zh-CN": "社区" },
  hubpedia: { ja: "Hubpedia", en: "Hubpedia", ko: "Hubpedia", "zh-CN": "Hubpedia" },
  tokens: { ja: "トークン", en: "Tokens", ko: "토큰", "zh-CN": "代币" }
};

function ThreadList({ entries, locale }: { entries: ThreadTrend[]; locale: HubLocale }) {
  return entries.length ? <div className="rank-list">{entries.map((entry, index) => (
    <a key={entry.thread.id} href={`/threads/${entry.thread.id}`} className="rank-row">
      <b>{index + 1}</b>
      <span><small>{entry.board?.title ?? localizedText(locale, { ja: "カテゴリ未設定", en: "Uncategorized", ko: "미분류", "zh-CN": "未分类" })}</small><strong>{entry.thread.title}</strong><em>{localizedText(locale, { ja: `直近 ${entry.thread.recentPostCount ?? 0}件・参加者 ${entry.thread.recentParticipantCount ?? 0}人`, en: `${entry.thread.recentPostCount ?? 0} recent posts · ${entry.thread.recentParticipantCount ?? 0} participants`, ko: `최근 ${entry.thread.recentPostCount ?? 0}개 · 참여자 ${entry.thread.recentParticipantCount ?? 0}명`, "zh-CN": `近期 ${entry.thread.recentPostCount ?? 0} 条 · ${entry.thread.recentParticipantCount ?? 0} 人参与` })}</em></span>
      <i>{localizedText(locale, { ja: "勢い", en: "Momentum", ko: "상승세", "zh-CN": "热度" })} {entry.momentum}</i>
    </a>
  ))}</div> : <div className="empty-state"><p>現在話題のスレッドはありません。</p></div>;
}

function PostList({ entries, locale }: { entries: SocialTrend[]; locale: HubLocale }) {
  return entries.length ? <div className="rank-list">{entries.map((entry, index) => (
    <a key={entry.post.id} href={`/posts/${entry.post.id}`} className="rank-row rank-row--post">
      <b>{index + 1}</b>
      <span>
        <small>{entry.post.displayName}{entry.post.handle ? ` @${entry.post.handle}` : ""}</small>
        <p className="rank-row__post-body">{entry.post.body || "本文のない投稿"}</p>
        <em>{localizedText(locale, { ja: `返信 ${entry.replyCount}・リポスト ${entry.repostCount ?? 0}・いいね ${entry.likeCount ?? 0}`, en: `${entry.replyCount} replies · ${entry.repostCount ?? 0} reposts · ${entry.likeCount ?? 0} likes`, ko: `답글 ${entry.replyCount} · 재게시 ${entry.repostCount ?? 0} · 좋아요 ${entry.likeCount ?? 0}`, "zh-CN": `回复 ${entry.replyCount} · 转发 ${entry.repostCount ?? 0} · 赞 ${entry.likeCount ?? 0}` })}</em>
      </span>
      <i>{localizedText(locale, { ja: "勢い", en: "Momentum", ko: "상승세", "zh-CN": "热度" })} {entry.score}</i>
    </a>
  ))}</div> : <div className="empty-state"><p>集計できる投稿はまだありません。</p></div>;
}

function HubpediaList({ entries }: { entries: HubpediaTrend[] }) {
  return entries.length ? <div className="rank-list">{entries.map((entry, index) => (
    <a key={entry.slug} href={`/hubpedia/${entry.slug}`} className="rank-row rank-row--post">
      <b>{index + 1}</b>
      <span><small>{entry.category}</small><strong>{entry.title}</strong></span>
      <i>注目度 {entry.score}</i>
    </a>
  ))}</div> : <div className="empty-state"><p>集計できるHubpedia記事はまだありません。</p></div>;
}

function TokenList({ entries }: { entries: TokenTrend[] }) {
  return entries.length ? <div className="rank-list">{entries.map((entry, index) => (
    <a key={entry.id} href={`/token?ranking=${encodeURIComponent(entry.id)}`} className="rank-row">
      <b>{index + 1}</b>
      <span><small>{entry.network}</small><strong>{entry.title}</strong><em>{entry.holderCount}人の公開保有者</em></span>
      <i>{entry.symbol}</i>
    </a>
  ))}</div> : <div className="empty-state"><p>集計できるトークンはまだありません。</p></div>;
}

function CommunityList({ entries }: { entries: CommunityTrend[] }) {
  return entries.length ? <div className="rank-list">{entries.map((entry, index) => (
    <a key={entry.id} href={`/community?community=${encodeURIComponent(entry.slug)}`} className="rank-row">
      <b>{index + 1}</b>
      <span><small>{entry.category}</small><strong>{entry.name}</strong><em>{entry.memberCount}人 · 最近の参加 {entry.recentMemberCount}人</em></span>
      <i>スコア {entry.score}</i>
    </a>
  ))}</div> : <div className="empty-state"><p>集計できるコミュニティはまだありません。</p></div>;
}

function TagList({ entries, locale }: { entries: TagTrend[]; locale: HubLocale }) {
  return entries.length ? <div className="rank-list">{entries.map((entry, index) => (
    <a key={entry.key} href={`/search?q=${encodeURIComponent(`#${entry.name}`)}`} className="rank-row">
      <b>{index + 1}</b>
      <span>
        <small>{localizedText(locale, { ja: "話題のタグ", en: "Trending topic", ko: "인기 태그", "zh-CN": "热门话题" })}</small>
        <strong>#{entry.name}</strong>
        <em>{localizedText(locale, {
          ja: `24時間 ${entry.recentCount}件・7日間 ${entry.totalCount}件`,
          en: `${entry.recentCount} in 24h · ${entry.totalCount} in 7d`,
          ko: `24시간 ${entry.recentCount}건 · 7일 ${entry.totalCount}건`,
          "zh-CN": `24小时 ${entry.recentCount} 条 · 7天 ${entry.totalCount} 条`,
        })}</em>
      </span>
      <i>{localizedText(locale, { ja: "勢い", en: "Momentum", ko: "상승세", "zh-CN": "热度" })} {entry.score}</i>
    </a>
  ))}</div> : <div className="empty-state"><p>直近24時間の話題タグはまだありません。</p></div>;
}

export function CommunityTrends({ threadRanking, socialRanking, hubpediaRanking, tokenRanking, communityRanking, tagRanking = [], locale = "ja" }: Props) {
  const [tab, setTab] = useState<TrendTab>("all");
  const [order, setOrder] = useState<TrendOrder>("rising");
  const tabs = Object.keys(TAB_LABELS) as TrendTab[];
  const orderedThreads = [...threadRanking].sort((left, right) => order === "rising"
    ? right.momentum - left.momentum
    : right.thread.postCount - left.thread.postCount);
  const orderedPosts = [...socialRanking].sort((left, right) => order === "rising"
    ? right.score - left.score
    : (right.replyCount + (right.repostCount ?? 0) + (right.likeCount ?? 0))
      - (left.replyCount + (left.repostCount ?? 0) + (left.likeCount ?? 0)));
  const orderedCommunities = [...communityRanking].sort((left, right) => order === "rising"
    ? right.score - left.score
    : right.memberCount - left.memberCount);
  const orderedHubpedia = [...hubpediaRanking].sort((left, right) => right.score - left.score);
  const orderedTokens = [...tokenRanking].sort((left, right) => order === "rising"
    ? right.score - left.score
    : right.holderCount - left.holderCount);
  const orderedTags = [...tagRanking].sort((left, right) => order === "rising"
    ? right.score - left.score
    : right.totalCount - left.totalCount);
  const tabCounts: Record<TrendTab, number> = {
    all: tagRanking.length + socialRanking.length + threadRanking.length + communityRanking.length + hubpediaRanking.length,
    topics: tagRanking.length,
    posts: socialRanking.length,
    threads: threadRanking.length,
    communities: communityRanking.length,
    hubpedia: hubpediaRanking.length,
    tokens: tokenRanking.length,
  };
  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, item: TrendTab) => {
    const currentIndex = tabs.indexOf(item);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = tabs[nextIndex]!;
    setTab(next);
    document.getElementById(`trend-tab-${next}`)?.focus();
  };

  return <section className="community-trends">
    <div className="community-trends__summary">
      <div><strong>{localizedText(locale, { ja: "いま伸びている話題", en: "What is rising now", ko: "지금 떠오르는 화제", "zh-CN": "当前热门话题" })}</strong><span>{localizedText(locale, { ja: "直近の投稿・参加・反応をもとに更新", en: "Updated from recent posts, participation, and reactions", ko: "최근 게시물·참여·반응을 바탕으로 업데이트", "zh-CN": "根据近期发帖、参与和互动更新" })}</span></div>
      <div className="community-trends__order" aria-label={localizedText(locale, { ja: "トレンドの並び順", en: "Trend order", ko: "트렌드 정렬", "zh-CN": "趋势排序" })}>
        <button type="button" aria-pressed={order === "rising"} onClick={() => setOrder("rising")}>{localizedText(locale, { ja: "急上昇", en: "Rising", ko: "급상승", "zh-CN": "上升最快" })}</button>
        <button type="button" aria-pressed={order === "popular"} onClick={() => setOrder("popular")}>{localizedText(locale, { ja: "人気", en: "Popular", ko: "인기", "zh-CN": "热门" })}</button>
      </div>
      <small>{localizedText(locale, { ja: `${tabCounts.all}件を集計`, en: `${tabCounts.all} signals`, ko: `${tabCounts.all}건 집계`, "zh-CN": `汇总 ${tabCounts.all} 项` })}</small>
    </div>
    <div className="trend-tabs" role="tablist" aria-label="トレンドの種類">
      {tabs.map((item) => (
        <button
          id={`trend-tab-${item}`}
          key={item}
          type="button"
          role="tab"
          aria-selected={tab === item}
          aria-controls="trend-tab-panel"
          tabIndex={tab === item ? 0 : -1}
          className={tab === item ? "trend-tabs__active" : ""}
          onClick={() => setTab(item)}
          onKeyDown={(event) => moveTab(event, item)}
        >
          <span>{localizedText(locale, TAB_LABELS[item])}</span>
          <small>{tabCounts[item]}</small>
        </button>
      ))}
    </div>

    <p className="trend-tabs__description" aria-live="polite">
      {tab === "all" ? "Hub全体から種類をまたいで注目項目を表示" : tab === "topics" ? "直近24時間に伸びたタグを表示" : tab === "posts" ? "反応が集まっているポストを表示" : tab === "threads" ? "投稿が集まっているスレッドを表示" : tab === "communities" ? "直近の投稿や参加が活発なコミュニティを表示" : tab === "hubpedia" ? "確認状態や出典が充実したHubpedia記事を表示" : "公開保有者が参加しているトークンを表示"}
    </p>

    <div id="trend-tab-panel" aria-labelledby={`trend-tab-${tab}`} className={`trend-panels${tab === "all" ? " trend-panels--split" : ""}`} role="tabpanel">
      {(tab === "all" || tab === "topics") && <article className="feature-panel"><div className="feature-panel__heading"><h2>{localizedText(locale, { ja: "話題のタグ", en: "Trending topics", ko: "인기 태그", "zh-CN": "热门话题" })}</h2><small>{tagRanking.length}</small></div><TagList locale={locale} entries={tab === "all" ? orderedTags.slice(0, 5) : orderedTags}/></article>}
      {(tab === "all" || tab === "posts") && <article className="feature-panel"><div className="feature-panel__heading"><h2>{localizedText(locale, { ja: "話題のポスト", en: "Trending posts", ko: "인기 게시물", "zh-CN": "热门帖子" })}</h2><small>{socialRanking.length}</small></div><PostList locale={locale} entries={tab === "all" ? orderedPosts.slice(0, 5) : orderedPosts}/></article>}
      {(tab === "all" || tab === "threads") && <article className="feature-panel"><div className="feature-panel__heading"><h2>{localizedText(locale, { ja: "人気のスレッド", en: "Popular threads", ko: "인기 스레드", "zh-CN": "热门主题" })}</h2><small>{threadRanking.length}</small></div><ThreadList locale={locale} entries={tab === "all" ? orderedThreads.slice(0, 5) : orderedThreads}/></article>}
      {(tab === "all" || tab === "communities") && <article className="feature-panel"><div className="feature-panel__heading"><h2>活発なコミュニティ</h2><small>{communityRanking.length}件</small></div><CommunityList entries={tab === "all" ? orderedCommunities.slice(0, 5) : orderedCommunities}/></article>}
      {(tab === "all" || tab === "hubpedia") && <article className="feature-panel"><div className="feature-panel__heading"><h2>注目のHubpedia</h2><small>{hubpediaRanking.length}件</small></div><HubpediaList entries={tab === "all" ? orderedHubpedia.slice(0, 5) : orderedHubpedia}/></article>}
      {tab === "tokens" && <article className="feature-panel"><div className="feature-panel__heading"><h2>公開トークンランキング</h2><small>{tokenRanking.length}件</small></div><TokenList entries={orderedTokens}/></article>}
    </div>
  </section>;
}
