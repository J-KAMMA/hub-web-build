"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { SearchSubmitButton } from "@/components/search-submit-button";
import { HorizontalScrollRail } from "@/components/horizontal-scroll-rail";

import type { Community } from "@/lib/domain";
import type { PublicVideoEntry } from "@/lib/server/d1-videos";

type CommunityPostPreview = { id: string; channelId: string; channelName: string; displayName: string; handle: string | null; body: string; createdAt: string; kind: "chat" | "guide" | "question" | "party"; pinned: boolean; workflowStatus: "open" | "resolved" | "closed"; replyCount: number; likeCount: number };

const railCache = new Map<string, { expiresAt: number; value: unknown }>();
async function cachedRailJson<T>(key: string, url: string, ttlMs = 60_000): Promise<T> {
  const cached = railCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("right_rail_unavailable");
  const value = await response.json() as T;
  railCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

function RailFrame({ title, href, query, onQuery, children }: { title: string; href: string; query: string; onQuery: (value: string) => void; onShowFeed: () => void; children: React.ReactNode }) {
  const [draft, setDraft] = useState(query);
  return <aside className="catalog-right-rail" aria-label={title}>
    <header><div><h2>{title}</h2></div></header>
    <form className="catalog-right-rail__search" role="search" onSubmit={(event) => { event.preventDefault(); onQuery(draft.trim()); }}><input type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`${title}を検索`} aria-label={`${title}を検索`} /><SearchSubmitButton label="検索" /></form>
    <div className="catalog-right-rail__list">{children}</div>
    <Link className="catalog-right-rail__all" href={href}>すべて見る</Link>
  </aside>;
}

function matches(query: string, fields: Array<string | undefined>) {
  const term = query.trim().toLocaleLowerCase("ja");
  return !term || fields.join(" ").toLocaleLowerCase("ja").includes(term);
}

export function CommunityRightRail({ onShowFeed }: { onShowFeed: () => void }) {
  const [items, setItems] = useState<Community[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<CommunityPostPreview[]>([]);
  useEffect(() => { void cachedRailJson<{ communities: Community[] }>("communities", "/api/communities").then((data) => {
    const communities = data.communities.slice(0, 15);
    setItems(communities);
    setSelectedId((current) => current || communities[0]?.id || "");
  }).catch(() => setItems([])); }, []);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setMessages([]);
    void cachedRailJson<{ posts: CommunityPostPreview[]; nextCursor: string | null }>(
      `community-posts:${selectedId}`,
      `/api/communities/${encodeURIComponent(selectedId)}/posts?limit=20`,
      30_000
    )
      .then((data) => {
        if (!active) return;
        setMessages(data.posts.slice(0, 20));
      })
      .catch(() => { if (active) setMessages([]); });
    return () => { active = false; };
  }, [selectedId]);
  const visible = useMemo(() => items.filter((item) => matches(query, [item.name, item.category, item.description])), [items, query]);
  const selected = items.find((item) => item.id === selectedId) ?? visible[0];
  return <RailFrame title="コミュニティ" href="/community" query={query} onQuery={setQuery} onShowFeed={onShowFeed}>
    <HorizontalScrollRail className="community-right-rail__selector-shell" viewportClassName="community-right-rail__selector" label="コミュニティ" scrollAmount={176}>{visible.map((item) => <button type="button" className={item.id === selected?.id ? "is-active" : ""} aria-pressed={item.id === selected?.id} key={item.id} onClick={() => setSelectedId(item.id)}><span aria-hidden="true">{item.name.slice(0, 1)}</span><strong>{item.name}</strong></button>)}</HorizontalScrollRail>
    {selected ? <div className="community-right-rail__current"><div><small>{selected.category} · コミュニティ投稿</small><strong>{selected.name}</strong></div><Link href={`/community?community=${encodeURIComponent(selected.slug)}`}>タブで開く</Link></div> : null}
    <div className="community-right-rail__posts">{messages.map((message) => <Link key={`${message.channelId}:${message.id}`} href={selected ? `/community?community=${encodeURIComponent(selected.slug)}` : "/community"}><span>{message.kind === "question" ? "質問" : message.kind === "guide" ? "ガイド" : message.kind === "party" ? "募集" : "投稿"}</span><strong>{message.displayName}{message.handle ? ` @${message.handle}` : ""} · {message.channelName}</strong><p>{message.body}</p><small>▲ {message.likeCount + message.replyCount}　返信 {message.replyCount}</small></Link>)}{selected && !messages.length ? <p className="catalog-right-rail__empty">このコミュニティには投稿がまだありません。</p> : null}</div>
    {!visible.length ? <p className="catalog-right-rail__empty">該当するコミュニティはありません。</p> : null}
  </RailFrame>;
}

export function VideoRightRail({ onShowFeed }: { onShowFeed: () => void }) {
  const [items, setItems] = useState<PublicVideoEntry[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => { void cachedRailJson<{ videos: PublicVideoEntry[] }>("videos", "/api/videos?limit=24&offset=0").then((data) => setItems(data.videos)).catch(() => setItems([])); }, []);
  const visible = useMemo(() => items.filter((item) => matches(query, [item.title, item.channel, item.topic, item.category])), [items, query]);
  return <RailFrame title="動画" href="/videos" query={query} onQuery={setQuery} onShowFeed={onShowFeed}>
    {visible.map((item) => <Link className="catalog-right-rail__item catalog-right-rail__item--media" key={item.id} href={`/videos/${item.id}`}>{item.thumbnailUrl ? <span className="catalog-right-rail__thumb"><img src={item.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /><i aria-hidden="true">▶</i></span> : null}<span className="catalog-right-rail__copy"><small>{item.provider} · {item.channel}</small><strong>{item.title}</strong><p>{item.viewCount.toLocaleString("ja-JP")}回視聴</p></span></Link>)}
    {!visible.length ? <p className="catalog-right-rail__empty">該当する動画はありません。</p> : null}
  </RailFrame>;
}
