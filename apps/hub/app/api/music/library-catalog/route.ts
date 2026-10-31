import { NextResponse } from "next/server";

import {
  canonicalizeMusicWork,
  musicAlbumLabel,
  type MusicWork,
} from "@/lib/music-catalog";
import { listWorkerMusicWorks } from "@/lib/server/music-worker-works";
import { listD1MusicWorks, listD1MusicWorksByIds } from "@/lib/server/d1-music";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

const ORIGINAL_TRACK_PREFIX = "music:";

function split(value: string | null, separator = ",", max = 200) {
  return (value ?? "").split(separator).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = new Set(split(url.searchParams.get("ids")));
  const artists = new Set(split(url.searchParams.get("artists"), "\u0000", 40));
  const albums = new Set(split(url.searchParams.get("albums"), "\u0000", 80));
  if (!ids.size && !artists.size && !albums.size) return NextResponse.json({ works: [] }, { headers: { "cache-control": "private, max-age=30" } });
  const database = getOptionalHubD1();
  const needsWorkerCatalog = artists.size > 0
    || albums.size > 0
    || [...ids].some((id) => id.startsWith(ORIGINAL_TRACK_PREFIX));
  let workerWorks: MusicWork[] = [];
  if (needsWorkerCatalog) {
    try {
      workerWorks = await listWorkerMusicWorks(url);
    } catch {
      return NextResponse.json(
        { error: "music_catalog_unavailable" },
        {
          status: 502,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }
  }
  let communityWorks: MusicWork[] = [];
  if (database) {
    if (artists.size || albums.size) communityWorks = await listD1MusicWorks(database);
    else {
      const wanted = [...ids].filter(id => !id.startsWith(ORIGINAL_TRACK_PREFIX));
      for (let offset = 0; offset < wanted.length; offset += 60) {
        communityWorks.push(...await listD1MusicWorksByIds(database, wanted.slice(offset, offset + 60)));
      }
    }
  }
  const uniqueWorks = new Map<string, MusicWork>();
  [...communityWorks.map(canonicalizeMusicWork), ...workerWorks]
    .filter((work) =>
      ids.has(work.id)
      || artists.has(work.artist)
      || albums.has(`${work.artist}\u0000${musicAlbumLabel(work)}`))
    .forEach((work) => uniqueWorks.set(work.id, work));
  const works = [...uniqueWorks.values()].slice(0, 300);
  return NextResponse.json({ works }, { headers: { "cache-control": "private, max-age=30" } });
}
