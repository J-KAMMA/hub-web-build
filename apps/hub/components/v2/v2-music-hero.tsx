"use client";

import Link from "next/link";
import { useState } from "react";

import { MediaFrame } from "@/components/v2/ui";
import { V2Button } from "@/components/v2/v2-button";
import { V2Icon } from "@/components/v2/v2-icons";
import { musicDisplayTitle, musicWorkArtworkUrl, type MusicWork } from "@/lib/music-catalog";
import { playableTrack } from "@/lib/v2-music";
import { musicWorkHref } from "@/lib/music-work-href";

/*
 * 注目のオリジナル1曲（SPEC 4.6）。絵を拡大してぼかした地、前面に絵 240、題・作者・再生。
 * 文字は地の上なので --media-app-text。選び方は呼び出し側（棚の先頭のオリジナル）で、ここは見た目だけ。
 */
export function V2MusicHero({ work, current, favorite, favoriteSaving, japanese, onPlay, onFavorite }: {
  work: MusicWork;
  current: boolean;
  favorite: boolean;
  favoriteSaving: boolean;
  japanese: boolean;
  onPlay: () => void;
  onFavorite: () => void;
}) {
  const [notice, setNotice] = useState("");
  const title = musicDisplayTitle(work.title);
  const art = musicWorkArtworkUrl(work);
  const track = playableTrack(work, false);
  const href = musicWorkHref(work.id);
  const share = async () => {
    const url = `${window.location.origin}${href}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); setNotice(japanese ? "リンクをコピーしました" : "Link copied"); }
    } catch { /* 共有の取り消しは何もしない。 */ }
  };
  return (
    <section className="v2-mhero v2-bleed" aria-label={japanese ? "注目のオリジナル" : "Featured original"} data-current={current || undefined}>
      <div className="v2-mhero__ground" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {art ? <img src={art} alt="" width={64} height={64} decoding="async" referrerPolicy="no-referrer" /> : null}
      </div>
      <div className="v2-mhero__inner">
        <div className="v2-mhero__art">
          <MediaFrame src={art} alt="" ratio="1/1" width={240} height={240} radius="lg" priority referrerPolicy="no-referrer">
            {art ? null : <span className="v2-mhero__symbol" aria-hidden="true">{work.symbol || "♪"}</span>}
          </MediaFrame>
        </div>
        <div className="v2-mhero__body">
          <span className="v2-mhero__tag">{"Hub Music"}</span>
          <h2 className="v2-mhero__title ui-title-wrap"><button type="button" className="v2-mhero__titlebutton" disabled={!track} onClick={onPlay}>{title}</button></h2>
          <Link className="v2-mhero__artist" href={`/v2/music/artists/${encodeURIComponent(work.artist)}`}>{work.artist}</Link>
          <div className="v2-mhero__actions">
            <button type="button" className="v2-mhero__play" disabled={!track} onClick={onPlay} aria-label={japanese ? `${title} を再生` : `Play ${title}`}>
              <V2Icon name="play" />
            </button>
            <V2Button icon="heart" label={favoriteSaving ? (japanese ? "お気に入りを保存中" : "Saving favourites") : favorite ? (japanese ? "お気に入り済み" : "Favourited") : (japanese ? "お気に入り" : "Favourite")} disabled={favoriteSaving} pressed={favorite} onClick={onFavorite} className="v2-mhero__icon" />
            <V2Button icon="share" label={japanese ? "共有" : "Share"} onClick={() => void share()} className="v2-mhero__icon" />
          </div>
        </div>
      </div>
      {notice ? <span className="ui-sr" role="status">{notice}</span> : null}
    </section>
  );
}
