import Link from "next/link";

import { V2VideoCard } from "@/components/v2/v2-video-card";
import type { PublicVideoEntry } from "@/lib/server/d1-videos";
import { isShort } from "@/lib/v2-video";
import "@/app/v2/v2-media-column.css";

export const SHORT_SHELF_SIZE = 10;

/* ホームの縦長（9:16）の棚。ショートは60秒以下でライブでないもの。2本に満たなければ棚ごと出さない。 */
export function V2ShortShelf({ videos, locale, href }: { videos: PublicVideoEntry[]; locale: string; href: string }) {
  const shorts = videos.filter((video) => isShort(video)).slice(0, SHORT_SHELF_SIZE);
  /* 1本だけの棚は左に1枚残るだけで棚に見えない。2本以上のときだけ出す。 */
  if (shorts.length < 2) return null;
  const ja = locale === "ja";
  return (
    <section className="v2-short-shelf" aria-labelledby="v2-short-shelf-title">
      <h2 id="v2-short-shelf-title" className="v2-short-shelf__title"><Link href={href}>{ja ? "ショート" : "Shorts"}</Link></h2>
      <ul className="v2-short-shelf__track">
        {shorts.map((video) => <li key={video.id}><V2VideoCard video={video} locale={locale} /></li>)}
      </ul>
    </section>
  );
}
