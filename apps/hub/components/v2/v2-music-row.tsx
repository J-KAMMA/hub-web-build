"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { V2ContentShare } from "./v2-content-share";
import { V2DownloadButton } from "./v2-content-download";
import { musicWorkHref } from "@/lib/music-work-href";
import { V2Button } from "./v2-button";
import { V2TagChipRow } from "./v2-tag-chip";
import { V2Icon } from "./v2-icons";
import { musicDisplayTitle, musicWorkArtworkUrl, type MusicWork } from "@/lib/music-catalog";
import { musicGenreChipLabel } from "@/lib/v2-music";
import { enqueueNextPersistentMusic } from "@/lib/music-player-events";
import { playableTrack } from "@/lib/v2-music";

export function V2MusicRow({ work, current, favorite, japanese, onPlay, onFavorite, onDismiss, favoriteSaving = false, compact = false }: {
  work: MusicWork; current: boolean; favorite: boolean; japanese: boolean;
  onPlay: () => void; onFavorite: () => void;
  onDismiss?: () => void;
  favoriteSaving?: boolean;
  /* 外部の曲の行。ハートは触れたときだけ出し（携帯では「…」の中だけ）、オリジナルより一段低く見せる。 */
  compact?: boolean;
}) {
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState(false);
  const [downloadable, setDownloadable] = useState<boolean | null>(null);
  const original = work.id.match(/^music:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$(?![sS])/i);
  const trackId = original ? original[1].toLowerCase() : null;
  /* The download permission belongs to Music; ask only once the menu is opened, and the server re-checks on every click. */
  useEffect(() => {
    const node = menu.current;
    if (!node) return;
    const onToggle = (event: Event) => setOpened((event as ToggleEvent).newState === "open");
    node.addEventListener("toggle", onToggle);
    return () => node.removeEventListener("toggle", onToggle);
  }, []);
  useEffect(() => {
    if (!opened || !trackId || downloadable !== null) return;
    let cancelled = false;
    fetch(`/music/api/tracks?ids=${trackId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { tracks?: Array<{ id?: string; downloadPolicy?: string }> } | null) => {
        if (!cancelled && body) setDownloadable(body.tracks?.find((item) => item.id === trackId)?.downloadPolicy === "anyone");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [opened, trackId, downloadable]);
  const title = musicDisplayTitle(work.title);
  const art = musicWorkArtworkUrl(work);
  const track = playableTrack(work, false);
  const artistHref = `/v2/music/artists/${encodeURIComponent(work.artist)}`;
  const playLabel = japanese ? `${title} を再生` : `Play ${title}`;
  return <li className="v2-music-row" data-current={current || undefined} data-compact={compact || undefined}>
    <button className="v2-music-row__art" type="button" disabled={!track} aria-label={playLabel} onClick={onPlay}>
      {art ? <img src={art} alt="" width={compact ? 40 : 48} height={compact ? 40 : 48} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span>{work.symbol}</span>}
      <span className="v2-music-row__play" aria-hidden="true"><V2Icon name="play" /></span>
    </button>
    <div className="v2-music-row__body">
      <button className="v2-music-row__title" type="button" disabled={!track} onClick={onPlay} title={title}>{title}</button>
      <div className="v2-music-row__meta" title={`${work.artist} · ${musicGenreChipLabel(work.genre)} · ${work.year}`}>
        <Link href={artistHref}>{work.artist}</Link><span> · {musicGenreChipLabel(work.genre)} · {work.year}</span>
      </div>
      {!compact ? <V2TagChipRow tags={work.tags} kind="music" max={3} size="sm" label={japanese ? "タグ" : "Tags"} /> : null}
    </div>
    <div className="v2-music-row__actions">
      <V2Button icon="heart" label={favoriteSaving ? (japanese ? "お気に入りを保存中" : "Saving favourites") : favorite ? (japanese ? "お気に入り済み" : "Favourited") : (japanese ? "お気に入り" : "Favourite")} disabled={favoriteSaving} pressed={favorite} onClick={onFavorite} className="v2-music-row__heart" />
      <button className="v2-music-row__more" type="button" popoverTarget={menuId} aria-label={japanese ? `${title} のその他の操作` : `More actions for ${title}`}
        onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setPosition({ left: Math.max(8, Math.min(r.right - 232, window.innerWidth - 240)), top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 468)) }); }}>
        <V2Icon name="more" />
      </button>
    </div>
    <div ref={menu} id={menuId} popover="auto" className="v2-music-row__menu" style={position}>
      <button type="button" disabled={!track} onClick={() => { if (!track) return; enqueueNextPersistentMusic(track); setNotice(japanese ? "次に再生します" : "Added to play next"); menu.current?.hidePopover(); }}>{japanese ? "次に再生" : "Play next"}</button>
      <button type="button" disabled={favoriteSaving} onClick={() => { onFavorite(); menu.current?.hidePopover(); }}>{favoriteSaving ? (japanese ? "お気に入りを保存中" : "Saving favourites") : favorite ? (japanese ? "お気に入りから外す" : "Remove favourite") : (japanese ? "お気に入りに保存" : "Save favourite")}</button>
      <Link href={artistHref} onClick={() => menu.current?.hidePopover()}>{japanese ? "アーティストへ" : "Go to artist"}</Link>
      <V2ContentShare href={musicWorkHref(work.id)} japanese={japanese} />
      {/* 外で聴く先は YouTube Music だけ。ほかの配信先のリンクは古いデータに残っていても出さない（2026-10-28）。 */}
      {work.services.filter((service) => service.provider === "youtube").slice(0, 1).map((service) => <a key={service.provider} href={service.url} target="_blank" rel="noreferrer noopener" aria-label={japanese ? "YouTube Musicで聴く（Hubの外へ移動）" : "Listen on YouTube Music (leaves Hub)"}>{japanese ? "YouTube Musicで聴く" : "Listen on YouTube Music"}</a>)}
      {trackId && opened ? <V2DownloadButton kind="music" id={trackId} allowed={downloadable} japanese={japanese} /> : null}
      {onDismiss ? <>
        <p>{japanese ? "音楽の再生履歴・お気に入り・ジャンルなどを基準に並べています。" : "Ordered using music listening history, favourites, genres and catalog signals."}</p>
        <button type="button" onClick={() => { menu.current?.hidePopover?.(); onDismiss(); }}>{japanese ? "興味なし" : "Not interested"}</button>
      </> : null}
    </div>
    {notice ? <span className="v2-sr" role="status">{notice}</span> : null}
  </li>;
}
