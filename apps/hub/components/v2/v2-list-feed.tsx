"use client";

import Link from "next/link";
import { useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2Post, type V2PostData } from "@/components/v2/v2-post";
import type { D1UserListFeedItem } from "@/lib/server/d1-user-list-feed";

/*
 * 持ち主のリストの流れ（?feed=list&list=…）。1頁目はサーバーが渡し、続きは
 * GET /api/lists/[listId]/feed を同じ Cookie で読む。本文の伏せ字（redactGated）はそちら側で済んでいる。
 * 無い・他人のリストは missing で、短い案内だけを出す（エラー画面にしない）。
 */
type Props = {
  listId: string;
  items: D1UserListFeedItem[];
  nextCursor: string | null;
  viewerId: string;
  locale: string;
  missing?: boolean;
};

const key = (item: D1UserListFeedItem) => item.kind === "social" ? `s:${item.post.id}` : `t:${item.response.id}`;

export function V2ListFeed({ listId, items: initial, nextCursor, viewerId, locale, missing = false }: Props) {
  const ja = locale === "ja";
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  if (missing) {
    return <V2Empty title={ja ? "このリストは見つかりません" : "This list is not available"} note={ja ? "削除されたか、あなたのリストではありません。" : "It may have been deleted, or it is not one of your lists."} action={{ label: ja ? "リストを見る" : "Open lists", href: "/v2/lists?tab=community" }} />;
  }

  const more = async () => {
    if (!cursor || state === "loading") return;
    setState("loading");
    try {
      const response = await fetch(`/api/lists/${encodeURIComponent(listId)}/feed?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as { items?: D1UserListFeedItem[]; nextCursor?: string | null } | null;
      if (!response.ok || !payload?.items) throw new Error(String(response.status));
      const fresh = payload.items;
      setItems((current) => {
        const seen = new Set(current.map(key));
        return [...current, ...fresh.filter((item) => !seen.has(key(item)))];
      });
      setCursor(fresh.length ? payload.nextCursor ?? null : null);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  if (!items.length) {
    return <V2Empty title={ja ? "このリストにはまだ流れがありません" : "Nothing in this list yet"} note={ja ? "リストに人やスレッドを入れると、ここに並びます。" : "Add people or threads to the list and they show up here."} action={{ label: ja ? "リストを編集する" : "Edit lists", href: "/v2/lists?tab=community" }} />;
  }

  return (
    <>
      <div className="v2-feed">
        {items.map((item) => item.kind === "social" ? (
          <div key={key(item)} className="v2-feed__row">
            <V2Post
              post={item.post as unknown as V2PostData}
              viewerId={viewerId}
              locale={locale}
              onRemoved={(postId) => setItems((current) => current.filter((entry) => !(entry.kind === "social" && entry.post.id === postId)))}
            />
          </div>
        ) : (
          <article key={key(item)} className="v2-feed__row v2-card">
            <Link href={`/v2/threads/${encodeURIComponent(item.response.threadId)}`}>{item.response.threadTitle}</Link>
            <p className="v2-card__meta">{item.response.displayName} · No.{item.response.no}</p>
            <p>{item.response.body}</p>
          </article>
        ))}
      </div>
      {cursor ? (
        <div className="v2-feed__more">
          <V2Button variant="text" label={state === "loading" ? (ja ? "読み込んでいます…" : "Loading…") : state === "failed" ? (ja ? "もう一度読み込む" : "Try again") : (ja ? "もっと見る" : "Load more")} disabled={state === "loading"} onClick={() => void more()} />
        </div>
      ) : null}
    </>
  );
}
