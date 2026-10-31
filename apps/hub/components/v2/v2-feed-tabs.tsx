import Link from "next/link";

import "@/app/v2/v2-media-column.css";

/*
 * タイムラインの上の並び（おすすめ・フォロー中・人気）。X と同じく本文の上に横並びの見出しにする（2026-10-27 所有者の指定）。
 * 行き先はそれぞれ別のURLなので、ボタンのタブではなくリンクで、選択中だけ aria-current を付ける。
 */
export type V2FeedTab = { key: string; label: string; href: string; selected: boolean };

export function V2FeedTabs({ label, tabs, className }: { label: string; tabs: V2FeedTab[]; className?: string }) {
  if (!tabs.length) return null;
  return (
    <nav className={className ? `v2-feed-tabs ${className}` : "v2-feed-tabs"} aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.key} className="v2-feed-tabs__tab" href={tab.href} aria-current={tab.selected ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
