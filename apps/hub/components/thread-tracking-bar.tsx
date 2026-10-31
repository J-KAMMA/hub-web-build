"use client";

import { useEffect, useState, useTransition } from "react";
import { getThreadUnreadState } from "@/lib/thread-state";

export function ThreadTrackingBar({ threadId, following: initialFollowing, lastReadPostNo, postCount }: {
  threadId: string; following: boolean; lastReadPostNo: number; postCount: number;
  notificationMode?: "instant" | "digest" | "important" | "none";
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const { firstUnreadPostNo, unreadCount } = getThreadUnreadState(lastReadPostNo, postCount);
  useEffect(() => {
    if (postCount <= lastReadPostNo) return;
    void fetch(`/api/bbs/threads/${threadId}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ last_read_post_no: postCount }) });
  }, [lastReadPostNo, postCount, threadId]);
  const toggle = () => {
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/bbs/threads/${threadId}/follow`, { method: "POST" });
      if (!response.ok) return setError("フォロー状態を更新できませんでした。");
      const payload = await response.json() as { tracking: { following: boolean } };
      setFollowing(payload.tracking.following);
    });
  };
  return <div className="thread-tracking-bar">
    <div><button type="button" className={following ? "thread-tracking-bar__following" : undefined} onClick={toggle} disabled={pending} aria-pressed={following}>{following ? "✓ フォロー中" : "＋ この話題をフォロー"}</button></div>
    {firstUnreadPostNo ? <a href={`#post-${firstUnreadPostNo}`}>未読 {unreadCount}件へ →</a> : <span className="thread-tracking-bar__read">最新まで既読</span>}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
