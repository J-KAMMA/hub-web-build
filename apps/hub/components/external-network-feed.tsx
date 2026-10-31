"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

import styles from "./external-network-feed.module.css";

type ExternalFeedItem = {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName: string;
  };
  text: string;
  createdAt: string;
  indexedAt: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
};

function publicPostUrl(item: ExternalFeedItem) {
  const match = item.uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  return match
    ? `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`
    : null;
}

type FeedIssue = "authentication" | "connection" | "unavailable";
const EXTERNAL_FEED_TIMEOUT_MS = 10_000;

class ExternalFeedTimeoutError extends Error {
  constructor() {
    super("external_feed_timeout");
    this.name = "TimeoutError";
  }
}

function issueMessage(issue: FeedIssue) {
  switch (issue) {
    case "authentication":
      return "ログイン状態を確認できませんでした。ログインし直してから再試行してください。";
    case "unavailable":
      return "外部SNSとの接続を確認できませんでした。設定でAT Protocolの連携状態を確認してください。";
    default:
      return "外部SNSのフィードを読み込めませんでした。接続を確認して再試行してください。";
  }
}

export function ExternalNetworkFeed() {
  const [items, setItems] = useState<ExternalFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState("外部SNSフィードを読み込んでいます。");
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<FeedIssue | null>(null);
  const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);

  const load = useCallback(async (nextCursor?: string | null) => {
    activeRequestRef.current?.controller.abort();
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };
    const ownsRequest = () => activeRequestRef.current?.id === requestId;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    setBusy(true);
    setIssue(null);
    if (!nextCursor) {
      setNotice("外部SNSフィードを読み込んでいます。");
      setEndReached(false);
    }
    const query = nextCursor
      ? `?cursor=${encodeURIComponent(nextCursor)}`
      : "";
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetch(
            `/api/core/external-protocols/atproto/feed${query}`,
            {
              cache: "no-store",
              credentials: "same-origin",
              signal: controller.signal,
            },
          );
          const payload = response.ok
            ? await response.json() as {
              items?: ExternalFeedItem[];
              cursor?: string | null;
            }
            : null;
          return { response, payload };
        })(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new ExternalFeedTimeoutError());
          }, EXTERNAL_FEED_TIMEOUT_MS);
        }),
      ]);
      if (!ownsRequest()) return;
      const { response, payload } = result;
      if (!response.ok) {
        const nextIssue: FeedIssue = response.status === 401 || response.status === 403
          ? "authentication"
          : response.status === 503
            ? "unavailable"
            : "connection";
        setIssue(nextIssue);
        setRetryCursor(nextCursor ?? null);
        setNotice(issueMessage(nextIssue));
        return;
      }
      if (!ownsRequest()) return;
      const received = Array.isArray(payload?.items) ? payload.items : [];
      setItems((current) => nextCursor ? [...current, ...received] : received);
      const receivedCursor = typeof payload?.cursor === "string"
        ? payload.cursor
        : null;
      const hasNextPage = received.length > 0
        && receivedCursor !== null
        && receivedCursor !== nextCursor;
      setCursor(hasNextPage ? receivedCursor : null);
      setRetryCursor(null);
      setEndReached(Boolean(nextCursor) && !hasNextPage);
      setNotice(received.length ? "" : "外部SNSの新しい投稿はありません。");
    } catch (error: unknown) {
      if (!ownsRequest()) return;
      if (
        error instanceof DOMException
        && error.name === "AbortError"
        && !timedOut
      ) return;
      setIssue("connection");
      setRetryCursor(nextCursor ?? null);
      setNotice(issueMessage("connection"));
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (ownsRequest()) {
        activeRequestRef.current = null;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    };
  }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>外部SNS</h1>
        <p>AT Protocolでフォローしているアカウントの公開投稿です。</p>
      </header>
      {items.length ? (
        <div className={styles.list}>
          {items.map((item) => {
            const href = publicPostUrl(item);
            return (
              <article className={styles.card} key={item.uri}>
                <div className={styles.identity}>
                  <strong>{item.author.displayName}</strong>
                  <span>@{item.author.handle}</span>
                  <span>{new Date(item.createdAt).toLocaleString("ja-JP")}</span>
                </div>
                <p className={styles.body}>{item.text}</p>
                <div className={styles.metadata}>
                  <span>返信 {item.replyCount}</span>
                  <span>リポスト {item.repostCount}</span>
                  <span>いいね {item.likeCount}</span>
                </div>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    元の投稿を見る
                  </a>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : !issue ? (
        <p className={styles.empty} role="status">{notice}</p>
      ) : null}
      {issue ? (
        <div className={styles.recovery} role="status">
          <p>{notice}</p>
          <div className={styles.recoveryActions}>
            <button type="button" className={styles.more} disabled={busy} onClick={() => void load(retryCursor)}>
              {busy ? "読み込み中…" : "再試行"}
            </button>
            {issue === "unavailable" ? <Link href="/settings">設定を開く</Link> : null}
            {issue === "authentication" ? <Link href="/auth?next=/feed/external">ログインする</Link> : null}
          </div>
        </div>
      ) : null}
      {cursor && !issue ? (
        <button
          className={styles.more}
          type="button"
          disabled={busy}
          onClick={() => void load(cursor)}
        >
          {busy ? "読み込み中…" : "さらに読み込む"}
        </button>
      ) : null}
      {items.length > 0 && endReached && !issue ? (
        <p className={styles.empty} role="status">すべての投稿を読み込みました。</p>
      ) : null}
    </div>
  );
}
