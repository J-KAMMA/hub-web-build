"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Skeleton } from "@/components/v2/v2-skeleton";
import type { ProfileListItem } from "@/lib/server/profile-page-data";
import { displayInitial } from "@/lib/display-initial";

/*
 * フォロワー／フォロー中の一覧。既存の profile-connection-list.tsx と同じ API
 * （GET /api/profiles/{handle}/connections?kind=&limit=40&cursor=）で、40件ずつ取り足す。
 */
type Payload = { profiles?: ProfileListItem[]; nextCursor?: string | null; hasMore?: boolean; error?: string };

type ConnectionsProps = { handle: string; kind: "followers" | "following"; japanese: boolean };

export function V2Connections(props: ConnectionsProps) {
  return <ConnectionsList key={JSON.stringify([props.handle, props.kind])} {...props} />;
}

function ConnectionsList({ handle, kind, japanese }: ConnectionsProps) {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [state, setState] = useState<"loading" | "idle" | "failed">("loading");

  const load = useCallback(async (after: string | null) => {
    setState("loading");
    try {
      const query = new URLSearchParams({ kind, limit: "40" });
      if (after) query.set("cursor", after);
      const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}/connections?${query.toString()}`, { credentials: "same-origin", signal: AbortSignal.timeout(30_000) });
      const payload = await response.json().catch(() => ({})) as Payload;
      if (!response.ok || !payload.profiles) throw new Error(payload.error || String(response.status));
      setProfiles((current) => {
        const known = new Set(current.map((profile) => profile.id));
        return [...current, ...payload.profiles!.filter((profile) => !known.has(profile.id))];
      });
      setCursor(payload.nextCursor ?? null);
      setHasMore(Boolean(payload.hasMore && payload.nextCursor));
      setState("idle");
    } catch {
      setState("failed");
    }
  }, [handle, kind]);

  useEffect(() => { void load(null); }, [load]);

  if (state === "failed" && !profiles.length) {
    return (
      <p className="v2-error" role="alert">
        {japanese ? "一覧を読み込めませんでした。" : "Could not load the list."}{" "}
        <button type="button" className="v2-card__link" onClick={() => void load(null)}>{japanese ? "再試行" : "Retry"}</button>
      </p>
    );
  }
  if (state === "loading" && !profiles.length) return <V2Skeleton kind="rows" count={5} japanese={japanese} />;
  if (!profiles.length) {
    return <p className="v2-note">{kind === "followers" ? (japanese ? "フォロワーはまだいません。" : "No followers yet.") : (japanese ? "まだ誰もフォローしていません。" : "Not following anyone yet.")}</p>;
  }

  return (
    <>
      <ul className="v2-people">
        {profiles.map((profile) => (
          <li key={profile.id} className="v2-person">
            {profile.avatarUrl
              ? <img className="v2-post__avatar" src={profile.avatarUrl} alt="" width={44} height={44} />
              : <span className="v2-post__avatar v2-post__avatar--placeholder" data-initial={displayInitial(profile.displayName)} aria-hidden="true" />}
            <Link className="v2-person__body" href={`/v2/profile/${profile.handle}`}>
              <span className="v2-post__name">{profile.displayName}</span>
              <span className="v2-post__handle">@{profile.handle}</span>
            </Link>
          </li>
        ))}
      </ul>
      {state === "failed" ? (
        <p className="v2-error" role="alert">
          {japanese ? "続きを読み込めませんでした。" : "Could not load more people."}{" "}
          <button type="button" className="v2-card__link" onClick={() => void load(cursor)}>{japanese ? "再試行" : "Retry"}</button>
        </p>
      ) : null}
      {hasMore && state !== "failed" ? (
        <div className="v2-feed__more">
          <V2Button variant="text" label={state === "loading" ? (japanese ? "読み込んでいます…" : "Loading…") : (japanese ? "もっと見る" : "Load more")} disabled={state === "loading"} onClick={() => void load(cursor)} />
        </div>
      ) : null}
    </>
  );
}
