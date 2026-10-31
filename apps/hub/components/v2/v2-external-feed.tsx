"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Skeleton } from "@/components/v2/v2-skeleton";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

/*
 * 外部SNS（AT Protocol）のフィード。既存の external-network-feed.tsx から機能だけを抜いた:
 * GET /api/core/external-protocols/atproto/feed?cursor= を10秒で打ち切り、
 * 401/403 は「ログインし直す」、503 は「連携を確かめる」、他は「接続を確かめる」。
 * 取り足しと再試行。投稿は bsky.app の公開URLへ渡す。
 */
type Item = {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName: string };
  text: string;
  createdAt: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
};

type Issue = "authentication" | "connection" | "unavailable" | null;

function publicUrl(item: Item) {
  const match = item.uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  return match ? `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}` : null;
}

export function V2ExternalFeed({ japanese, locale }: { japanese: boolean; locale: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState<Issue>(null);

  const load = useCallback(async (after: string | null) => {
    setLoading(true);
    setIssue(null);
    try {
      const response = await fetch(`/api/core/external-protocols/atproto/feed${after ? `?cursor=${encodeURIComponent(after)}` : ""}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        setIssue(response.status === 401 || response.status === 403 ? "authentication" : response.status === 503 ? "unavailable" : "connection");
        return;
      }
      const payload = await response.json() as { items?: Item[]; cursor?: string | null };
      const fresh = payload.items ?? [];
      setItems((current) => {
        const known = new Set(current.map((item) => item.uri));
        return [...current, ...fresh.filter((item) => !known.has(item.uri))];
      });
      setCursor(payload.cursor ?? null);
      setEnded(!payload.cursor || fresh.length === 0);
    } catch {
      setIssue("connection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(null); }, [load]);

  const message = issue === "authentication"
    ? (japanese ? "ログイン状態を確かめられませんでした。ログインし直してから再試行してください。" : "Could not confirm your session. Sign in again and retry.")
    : issue === "unavailable"
      ? (japanese ? "外部SNSとの接続を確かめられませんでした。設定で AT Protocol の連携を確かめてください。" : "Could not reach the external network. Check the AT Protocol link in settings.")
      : issue === "connection"
        ? (japanese ? "外部SNSのフィードを読み込めませんでした。接続を確かめて再試行してください。" : "Could not load the external feed. Check the connection and retry.")
        : null;

  return (
    <div className="v2-feed">
      {message ? (
        <div className="v2-error v2-feed__error" role="alert">
          <p>{message}</p>
          <div className="v2-feed__error-actions">
            <button type="button" className="v2-toggle v2-toggle--text" onClick={() => void load(cursor)}>{japanese ? "再試行" : "Retry"}</button>
            {issue === "unavailable" ? <Link className="v2-toggle v2-toggle--text" href="/v2/settings#v2-settings-external-protocols">{japanese ? "連携の設定" : "Link settings"}</Link> : null}
          </div>
        </div>
      ) : null}
      {items.map((item) => {
        const href = publicUrl(item);
        return (
          <div key={item.uri}>
            <article className="v2-post">
              <span className="v2-post__avatar" aria-hidden="true" />
              <div className="v2-post__body">
                <header className="v2-post__header">
                  <span className="v2-post__name">{item.author.displayName || item.author.handle}</span>
                  <span className="v2-post__handle">@{item.author.handle}</span>
                  <span className="v2-post__time"><V2RelativeTime value={item.createdAt} locale={locale} /></span>
                </header>
                <p className="v2-post__text">{item.text}</p>
                <div className="v2-post__actions">
                  <span className="v2-post__own">{japanese ? `返信 ${item.replyCount} · リポスト ${item.repostCount} · いいね ${item.likeCount}` : `${item.replyCount} replies · ${item.repostCount} reposts · ${item.likeCount} likes`}</span>
                  {href ? <V2Button icon="external" variant="text" label={japanese ? "Bluesky で開く" : "Open on Bluesky"} href={href} external /> : null}
                </div>
              </div>
            </article>
          </div>
        );
      })}
      {!items.length && !message && !loading ? <p className="v2-note">{japanese ? "外部SNSの投稿はまだありません。" : "No external posts yet."}</p> : null}
      {loading && !items.length ? <V2Skeleton kind="rows" count={4} japanese={japanese} /> : null}
      {items.length && !ended ? (
        <div className="v2-feed__more">
          <V2Button variant="text" label={loading ? (japanese ? "読み込んでいます…" : "Loading…") : (japanese ? "もっと見る" : "Load more")} disabled={loading} onClick={() => void load(cursor)} />
        </div>
      ) : null}
    </div>
  );
}
