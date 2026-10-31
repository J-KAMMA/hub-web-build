import Link from "next/link";

import { Tabs } from "@/components/v2/ui/tabs";
import { V2Icon } from "@/components/v2/v2-icons";

/*
 * 音楽の下位画面（ライブラリ・履歴・アップロード・スタジオ）の見出しの下。
 * 左に「音楽へ戻る」の矢印、その下に下線タブ。購入の操作は置かない。
 */
const ITEMS = [
  { id: "library", label: "ライブラリ", href: "/v2/music/library" },
  { id: "history", label: "履歴", href: "/v2/music/history" },
  { id: "upload", label: "アップロード", href: "/v2/music/upload" },
  { id: "studio", label: "スタジオ", href: "/v2/music/studio" },
] as const;

export function MusicSectionNav({ current }: { current: (typeof ITEMS)[number]["id"] }) {
  return (
    <div className="music-section-nav">
      <Link className="music-section-nav__back" href="/v2/music" aria-label="音楽へ戻る">
        <V2Icon name="chevron-left" />
        <span>音楽</span>
      </Link>
      <Tabs items={ITEMS} value={current} label="音楽の管理" />
    </div>
  );
}
