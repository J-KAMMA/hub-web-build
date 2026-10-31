"use client";

import { useEffect, useState, useTransition } from "react";

/*
 * フォローと既読。既存の thread-tracking-bar.tsx と同じ契約。
 *   - 開いたとき、未読があれば最新まで既読にする（POST /read）
 *   - フォローは POST /follow の切り替え。返ってきた tracking を信じる
 *   - 最初の未読へのアンカーを出す
 */
export function V2ThreadTracking({
  threadId,
  following: initialFollowing,
  lastReadPostNo,
  postCount,
  japanese,
}: {
  threadId: string;
  following: boolean;
  lastReadPostNo: number;
  postCount: number;
  japanese: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const unread = Math.max(0, postCount - lastReadPostNo);
  const firstUnread = lastReadPostNo > 0 && unread > 0 ? lastReadPostNo + 1 : 0;

  useEffect(() => {
    if (postCount <= lastReadPostNo) return;
    void fetch(`/api/bbs/threads/${threadId}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ last_read_post_no: postCount }),
    }).catch(() => undefined);
  }, [lastReadPostNo, postCount, threadId]);

  const toggle = () => {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/bbs/threads/${threadId}/follow`, { method: "POST" });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { tracking: { following: boolean } };
        setFollowing(payload.tracking.following);
        setError("");
      } catch {
        setError(japanese ? "フォロー状態を更新できませんでした。" : "Could not update following.");
      }
    });
  };

  return (
    <div className="v2-tracking">
      <button type="button" className="v2-toggle v2-toggle--text" aria-pressed={following} disabled={pending} onClick={toggle}>
        {following ? (japanese ? "✓ フォロー中" : "✓ Following") : (japanese ? "＋ この話題をフォロー" : "＋ Follow")}
      </button>
      {firstUnread
        ? <a className="v2-card__link" href={`#post-${firstUnread}`}>{japanese ? `未読 ${unread}件へ →` : `${unread} unread →`}</a>
        : <span className="v2-tracking__read">{japanese ? "最新まで既読" : "All read"}</span>}
      {error ? <span className="v2-error" role="alert">{error}</span> : null}
    </div>
  );
}
