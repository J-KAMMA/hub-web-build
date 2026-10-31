"use client";

import Link from "next/link";

import { MediaFrame } from "@/components/v2/ui";
import { V2Button } from "@/components/v2/v2-button";
import { V2Icon } from "@/components/v2/v2-icons";
import { musicDisplayTitle, musicWorkArtworkUrl, type MusicWork } from "@/lib/music-catalog";
import { playableTrack } from "@/lib/v2-music";

/*
 * Hub オリジナルの札（SPEC 4.6）。絵 180（携帯 148）、題1行、作者1行。再生は絵全体が押せ、
 * 触れたときに右下へ再生の丸が出る。外部の曲は札にせず、v2-music-row の低い行にする。
 */
export function V2MusicTile({ work, current, favorite, favoriteSaving, japanese, onPlay, onFavorite }: {
  work: MusicWork;
  current: boolean;
  favorite: boolean;
  favoriteSaving: boolean;
  japanese: boolean;
  onPlay: () => void;
  onFavorite: () => void;
}) {
  const title = musicDisplayTitle(work.title);
  const art = musicWorkArtworkUrl(work);
  const track = playableTrack(work, false);
  return (
    <li className="v2-mtile" data-current={current || undefined}>
      <div className="v2-mtile__art">
        <MediaFrame src={art} alt="" ratio="1/1" width={180} height={180} radius="md" referrerPolicy="no-referrer">
          {art ? null : <span className="v2-mtile__symbol" aria-hidden="true">{work.symbol || "♪"}</span>}
        </MediaFrame>
        <button type="button" className="v2-mtile__hit" disabled={!track} onClick={onPlay} aria-label={japanese ? `${title} を再生` : `Play ${title}`}>
          <span className="v2-mtile__play" aria-hidden="true"><V2Icon name="play" /></span>
        </button>
      </div>
      <div className="v2-mtile__body">
        <div className="v2-mtile__text">
          <button type="button" className="v2-mtile__title" disabled={!track} onClick={onPlay} title={title}>{title}</button>
          <Link className="v2-mtile__artist" href={`/v2/music/artists/${encodeURIComponent(work.artist)}`}>{work.artist}</Link>
        </div>
        <V2Button icon="heart" label={favoriteSaving ? (japanese ? "お気に入りを保存中" : "Saving favourites") : favorite ? (japanese ? "お気に入り済み" : "Favourited") : (japanese ? "お気に入り" : "Favourite")} disabled={favoriteSaving} pressed={favorite} onClick={onFavorite} className="v2-mtile__heart" />
      </div>
    </li>
  );
}
