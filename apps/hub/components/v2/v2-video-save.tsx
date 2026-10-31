"use client";

import { useEffect, useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";

/* あとで見る。既存と同じ POST/DELETE /api/videos/{id}/save → { saved }。 */
export function V2VideoSave({ videoId, initialSaved, authenticated, locale }: { videoId: string; initialSaved: boolean; authenticated: boolean; locale: string }) {
  const ja = locale === "ja";
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mutation = useRef(0);

  /* 動的遷移では同じ client component が次の動画にも残る。前の動画の状態や返答を持ち越さない。 */
  useEffect(() => {
    mutation.current += 1;
    inFlight.current = false;
    setSaved(initialSaved);
    setPending(false);
    setError(null);
  }, [videoId, initialSaved]);

  const toggle = async () => {
    if (!authenticated || inFlight.current) return;
    inFlight.current = true;
    const currentMutation = ++mutation.current;
    setPending(true);
    const before = saved;
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/save`, { method: before ? "DELETE" : "POST" });
      const payload = await response.json().catch(() => ({})) as { saved?: boolean; error?: string };
      if (!response.ok) throw new Error(ja ? "保存状態を更新できませんでした。もう一度お試しください。" : "Could not update the saved state. Please try again.");
      if (!payload || typeof payload.saved !== "boolean" || payload.saved !== !before) throw new Error(ja ? "保存状態を確認できませんでした。もう一度お試しください。" : "Could not confirm the saved state. Please try again.");
      if (currentMutation !== mutation.current) return;
      setSaved(payload.saved);
      setError(null);
    } catch (caught) {
      if (currentMutation !== mutation.current) return;
      setSaved(before);
      setError(caught instanceof Error && caught.message ? caught.message : (ja ? "保存できませんでした。" : "Could not save."));
    } finally {
      if (currentMutation !== mutation.current) return;
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <V2Button icon="bookmark" variant="text" label={saved ? (ja ? "保存済み" : "Saved") : (ja ? "あとで見る" : "Watch later")} pressed={saved} disabled={!authenticated || pending} onClick={() => void toggle()} />
      {error ? <span className="v2-error" role="status">{error}</span> : null}
    </>
  );
}
