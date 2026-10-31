"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { V2Button } from "./v2-button";
import { V2DetailSection } from "./v2-detail";

/*
 * Original tracks from the Music Worker for a tag, fetched by the browser straight from the
 * edge-routed public API (Hub handlers do not proxy Music). The response is public data only
 * (published, clean, not hidden). On any failure or an empty answer nothing is rendered, so no
 * placeholder can hint at unpublished audio.
 */
type OriginalTrack = { id: string; title: string; artist: string; artworkUrl: string | null };

function parse(value: unknown): { items: OriginalTrack[]; nextCursor: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { items?: unknown; nextCursor?: unknown };
  if (!Array.isArray(record.items)) return null;
  const items: OriginalTrack[] = [];
  for (const raw of record.items) {
    const item = raw as Partial<OriginalTrack> | null;
    if (!item || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.artist !== "string") continue;
    items.push({ id: item.id, title: item.title, artist: item.artist, artworkUrl: typeof item.artworkUrl === "string" && item.artworkUrl.startsWith("/music/") ? item.artworkUrl : null });
  }
  return { items, nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null };
}

export function V2TagMusicOriginals({ slug, limit = 12, japanese = true, sectionTitle }: { slug: string; limit?: number; japanese?: boolean; sectionTitle?: string }) {
  const [tracks, setTracks] = useState<OriginalTrack[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function load(after: string | null) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ limit: String(limit) });
      if (after) query.set("cursor", after);
      const response = await fetch(`/music/api/v1/tags/${slug}/tracks?${query}`, { cache: "no-store", credentials: "omit" });
      if (!response.ok) return;
      const page = parse(await response.json().catch(() => null));
      if (!page) return;
      setTracks((current) => {
        const seen = new Set(current.map((track) => track.id));
        return [...current, ...page.items.filter((track) => !seen.has(track.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Fail closed: render nothing.
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tracks.length) return null;
  const body = (
    <div data-testid="tag-music-originals">
      <ul className="v2-mgrid">
        {tracks.map((track) => (
          <li key={track.id} className="v2-mcard">
            <Link className="v2-mcard__art" href={`/v2/music?q=${encodeURIComponent(track.title)}`}>
              {track.artworkUrl ? <img src={track.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <b aria-hidden="true">♪</b>}
            </Link>
            <div className="v2-mcard__body">
              <strong className="v2-mcard__title">{track.title}</strong>
              <span className="v2-mcard__artist">{track.artist}</span>
            </div>
          </li>
        ))}
      </ul>
      {cursor ? <V2Button variant="text" onClick={() => void load(cursor)} disabled={busy} label={japanese ? "さらに表示" : "Show more"} /> : null}
    </div>
  );
  /* Used alone (no Hub works for the tag), the island brings its own section heading, and only when it has tracks. */
  return sectionTitle ? <V2DetailSection title={sectionTitle}>{body}</V2DetailSection> : body;
}
