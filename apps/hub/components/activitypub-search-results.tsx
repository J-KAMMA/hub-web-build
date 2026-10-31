"use client";

import { useEffect, useState } from "react";
import styles from "./activitypub-search-results.module.css";

type Result = {
  actor?: { id: string; url: string; handle: string; name: string; summary: string };
  posts: Array<{ id: string; url: string; content: string; published?: string }>;
};

function eligible(query: string) {
  const value = query.trim();
  return /^(?:acct:)?@?[^@\s/]+@[^@\s/]+$/u.test(value) || /^https:\/\//iu.test(value);
}

export function ActivityPubSearchResults({ query, locale }: { query: string; locale: "ja" | "en" | string }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const enabled = eligible(query);

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      setResult(null);
      return;
    }
    const controller = new AbortController();
    setState("loading");
    fetch(`/api/federation/discover?${new URLSearchParams({ q: query })}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("discovery_failed");
        return response.json() as Promise<Result>;
      })
      .then((data) => {
        setResult(data);
        setState(data.actor || data.posts.length ? "ready" : "empty");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("error");
      });
    return () => controller.abort();
  }, [enabled, query]);

  if (!enabled || state === "idle") return null;
  return (
    <section className={styles.section} aria-live="polite">
      <div className={styles.heading}>
        <h2>ActivityPub</h2>
        <span>{locale === "ja" ? "外部ノードの公開情報" : "Public data from an external node"}</span>
      </div>
      {state === "loading" ? <p className={styles.state}>{locale === "ja" ? "外部ノードを確認しています…" : "Checking the external node…"}</p> : null}
      {state === "error" || state === "empty" ? <p className={styles.state}>{locale === "ja" ? "公開情報を取得できませんでした。URLまたは @名前@サーバー を確認してください。" : "Public information could not be loaded. Check the URL or @name@server."}</p> : null}
      {state === "ready" && result?.actor ? (
        <a className={styles.actor} href={result.actor.url} target="_blank" rel="noreferrer">
          <strong>{result.actor.name}</strong>
          <small>{result.actor.handle}</small>
          {result.actor.summary ? <p>{result.actor.summary}</p> : null}
        </a>
      ) : null}
      {state === "ready" && result?.posts.length ? (
        <div className={styles.posts}>
          {result.posts.map((post) => (
            <a className={styles.post} href={post.url} target="_blank" rel="noreferrer" key={post.id}>
              <p>{post.content}</p>
              {post.published ? <time dateTime={post.published}>{new Date(post.published).toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}</time> : null}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
