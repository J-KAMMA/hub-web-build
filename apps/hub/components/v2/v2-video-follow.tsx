"use client";

import { useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";

export type V2VideoFollowTarget =
  | { kind: "profile"; profileId: string }
  | { kind: "channel"; channel: string; provider: string };

/*
 * 動画のチャンネルのフォロー。Hub動画は投稿者のプロフィールのフォロー（POST /api/follows/toggle）、
 * 外部の動画はチャンネルのフォロー（PUT/DELETE /api/videos/channels）。どちらも既存の経路。
 * 未ログインは押し手でなくログインへのリンク。
 */
export function V2VideoFollow({ target, initialFollowing, authenticated, locale }: { target: V2VideoFollowTarget; initialFollowing: boolean; authenticated: boolean; locale: string }) {
  const ja = locale === "ja";
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (!authenticated) {
    return <V2Button variant="primary" label={ja ? "フォロー" : "Follow"} href="/v2/auth" title={ja ? "ログインするとフォローできます" : "Sign in to follow"} />;
  }

  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !following;
    setPending(true);
    setFollowing(next);
    try {
      const response = target.kind === "profile"
        ? await fetch("/api/follows/toggle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_profile_id: target.profileId, active: next }) })
        : next
          ? await fetch("/api/videos/channels", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: target.channel, provider: target.provider }) })
          : await fetch(`/api/videos/channels?channel=${encodeURIComponent(target.channel)}&provider=${encodeURIComponent(target.provider)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { following?: boolean; followed?: boolean };
      if (!response.ok) throw new Error("failed");
      const confirmed = target.kind === "profile" ? payload.following : payload.followed;
      if (typeof confirmed === "boolean") setFollowing(confirmed);
      setError(null);
    } catch {
      setFollowing(!next);
      setError(ja ? "反映できませんでした。" : "That did not go through.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <V2Button variant={following ? "text" : "primary"} pressed={following} disabled={pending} label={following ? (ja ? "フォロー中" : "Following") : (ja ? "フォロー" : "Follow")} onClick={() => void toggle()} />
      {error ? <span className="v2-error" role="status">{error}</span> : null}
    </>
  );
}
