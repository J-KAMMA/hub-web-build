"use client";

import React, { useCallback, useEffect, useState } from "react";

import type { ProfileListItem } from "@/lib/server/profile-page-data";

type ConnectionKind = "followers" | "following";

interface ConnectionPayload {
  profiles?: ProfileListItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
  error?: string;
}

export function ProfileConnectionList({
  handle,
  kind,
}: {
  handle: string;
  kind: ConnectionKind;
}) {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ kind, limit: "40" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(
        `/api/profiles/${encodeURIComponent(handle)}/connections?${query.toString()}`,
        { credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => ({})) as ConnectionPayload;
      if (!response.ok || !payload.profiles) {
        throw new Error(payload.error ?? "profile_connections_failed");
      }
      setProfiles((current) => {
        const known = new Set(current.map((profile) => profile.id));
        return [...current, ...payload.profiles!.filter((profile) => !known.has(profile.id))];
      });
      setCursor(payload.nextCursor ?? null);
      setHasMore(Boolean(payload.hasMore && payload.nextCursor));
      setLoaded(true);
    } catch {
      setError("一覧を読み込めませんでした。もう一度お試しください。");
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [cursor, handle, hasMore, kind, loading]);

  useEffect(() => {
    if (!loaded && !loading) void load();
  }, [load, loaded, loading]);

  return (
    <section className="profile-connections-page__list" aria-busy={loading}>
      {profiles.map((profile) => (
        <a key={profile.id} href={`/profile/${encodeURIComponent(profile.handle)}`} className="profile-connection-item">
          {profile.avatarUrl
            ? <img src={profile.avatarUrl} alt="" loading="lazy" />
            : <span aria-hidden="true">{profile.displayName.slice(0, 1)}</span>}
          <span><strong>{profile.displayName}</strong><small>@{profile.handle}</small></span>
        </a>
      ))}
      {loaded && profiles.length === 0 && !error
        ? <p className="profile-details-empty">まだ該当するユーザーはいません。</p>
        : null}
      {error ? <div className="profile-connections-page__error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>再試行</button>
      </div> : null}
      {hasMore && !error ? (
        <div className="search-load-more">
          <button type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "読み込み中…" : loaded ? "もっと見る" : "読み込む"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
