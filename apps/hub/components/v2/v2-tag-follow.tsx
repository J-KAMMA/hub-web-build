"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { V2Button } from "./v2-button";

/*
 * タグ頁のフォローボタン。状態の正本はサーバー（hub_article_tag_follows）。
 * 初期値はサーバーで読んで渡す。押したら API の返事で確定し、失敗したら元に戻して理由を出す。
 */
export function V2TagFollow({
  tag,
  initialFollowing,
  authenticated,
  japanese = true,
  signInNext,
}: {
  tag: string;
  initialFollowing: boolean;
  authenticated: boolean;
  japanese?: boolean;
  /* 未ログインのとき、ログイン後に戻る先。省略すると記事のタグ頁。 */
  signInNext?: string;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);

  if (!authenticated) {
    return (
      <Link className="v2-button v2-button--text" href={`/v2/auth?next=${encodeURIComponent(signInNext ?? `/v2/articles/tags/${encodeURIComponent(tag)}`)}`}>
        <span className="v2-button__label">{japanese ? "ログインしてフォロー" : "Sign in to follow"}</span>
      </Link>
    );
  }

  async function toggle() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    const next = !following;
    try {
      const response = await fetch(`/api/articles/tags/${encodeURIComponent(tag)}/follow`, { method: next ? "POST" : "DELETE" });
      const data = await response.json().catch(() => null) as { following?: unknown; error?: unknown } | null;
      if (!response.ok || data?.following !== next) {
        setMessage(typeof data?.error === "string" ? data.error : (japanese ? "フォローを更新できませんでした。" : "Could not update the follow."));
        return;
      }
      setFollowing(next);
    } catch {
      setMessage(japanese ? "フォローを更新できませんでした。" : "Could not update the follow.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <V2Button
        variant={following ? "text" : "primary"}
        icon={following ? "check" : "plus"}
        label={following ? (japanese ? "フォロー中" : "Following") : (japanese ? "フォロー" : "Follow")}
        pressed={following}
        disabled={pending}
        onClick={() => void toggle()}
      />
      {message ? <span role="status" className="v2-error">{message}</span> : null}
    </>
  );
}
