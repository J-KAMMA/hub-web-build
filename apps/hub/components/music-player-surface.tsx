"use client";

import { usePathname } from "next/navigation";

import { PersistentMusicPlayer } from "@/components/persistent-music-player";
import { V2MusicPlayer } from "@/components/v2/v2-music-player";
import { V2PlayerShell } from "@/components/v2/v2-player-shell";
import { V2VideoPlayer } from "@/components/v2/v2-video-player";

/*
 * 鳴らす場所は**画面にひとつ**（2026-09-03）。音楽と動画は同時に鳴らない
 * （どちらかが始まると、もう一方は一時停止する。lib/media-playback.ts）。
 * 2つ置くと iframe が2つできて、同じ曲が二重に鳴る。
 * /v2 では v2 のプレーヤー、それ以外は既存のミニプレーヤー。
 *
 * 根のレイアウトに置く。ここに置くから、画面を移っても鳴り続ける。
 * 画面の中（V2Shell）へ移すと、移動のたびに作り直されて音が切れる。
 */
export function MusicPlayerSurface() {
  const pathname = usePathname();
  const v2 = pathname === "/v2" || pathname?.startsWith("/v2/");
  if (!v2) return <PersistentMusicPlayer />;
  /* 2026-10-18：音楽と動画は1枚の小窓を分け合う。片方が鳴ると、もう片方は一時停止して下の1行に畳まれる。 */
  return <V2PlayerShell><V2MusicPlayer /><V2VideoPlayer /></V2PlayerShell>;
}
