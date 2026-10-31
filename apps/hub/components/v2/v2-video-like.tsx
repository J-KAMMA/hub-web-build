"use client";

import { useEffect, useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";

/*
 * 動画のいいね。GET/POST/DELETE /api/videos/{id}/engagement → { likeCount, likedByViewer }。
 * 表示は必ず「いいね」。数は押した直後に反映し、失敗したら戻す。未ログインは押し手でなくログインへのリンク。
 */
export function V2VideoLike({ videoId, authenticated, locale, className }: { videoId: string; authenticated: boolean; locale: string; className?: string }) {
  const ja = locale === "ja";
  const [state, setState] = useState<{ count: number; liked: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mutation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    mutation.current += 1;
    inFlight.current = false;
    setState(null);
    setError(null);
    setPending(false);
    fetch(`/api/videos/${encodeURIComponent(videoId)}/engagement`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { likeCount?: number; likedByViewer?: boolean } | null) => {
        if (!cancelled && payload && typeof payload.likeCount === "number") setState({ count: payload.likeCount, liked: Boolean(payload.likedByViewer) });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [videoId]);

  const label = ja ? "いいね" : "Like";
  if (!authenticated) {
    return <V2Button className={className} icon="heart" variant="text" label={label} count={state?.count} href="/v2/auth" title={ja ? "ログインするといいねできます" : "Sign in to like"} />;
  }

  const toggle = async () => {
    if (inFlight.current || !state) return;
    inFlight.current = true;
    const current = ++mutation.current;
    const before = state;
    setPending(true);
    setState({ count: Math.max(0, before.count + (before.liked ? -1 : 1)), liked: !before.liked });
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/engagement`, {
        method: before.liked ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: before.liked ? undefined : JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({})) as { likeCount?: number; likedByViewer?: boolean };
      if (!response.ok || typeof payload.likeCount !== "number") throw new Error("failed");
      if (current === mutation.current) { setState({ count: payload.likeCount, liked: Boolean(payload.likedByViewer) }); setError(null); }
    } catch {
      if (current === mutation.current) {
        setState(before);
        setError(ja ? "反映できませんでした。" : "That did not go through.");
      }
    } finally {
      if (current === mutation.current) { inFlight.current = false; setPending(false); }
    }
  };

  return (
    <>
      <V2Button className={className} icon="heart" variant="text" label={label} count={state?.count} pressed={state?.liked ?? false} disabled={!state || pending} onClick={() => void toggle()} />
      {error ? <span className="v2-error" role="status">{error}</span> : null}
    </>
  );
}
