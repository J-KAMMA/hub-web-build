import Link from "next/link";

import { Avatar } from "@/components/v2/ui/avatar";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2NavCount } from "@/components/v2/v2-nav-count";
import { V2NavPost } from "@/components/v2/v2-nav-post";
import type { V2NavItem } from "@/components/v2/v2-shell";
import { isCurrent } from "@/lib/v2-nav-current";

/*
 * ナビの項目の列（2026-10-11）。群の見出しも畳みも持たない、1本の平たい列。
 * `bottom` の付いた項目（プロフィール・設定）だけ別の ul にして下端へ寄せる。
 * 主な画面の列と下の列のあいだに「投稿する」を置く（2026-10-15 所有者指定。ウォレットは右列へ移した）。
 * 畳む・広げるは V2Columns のハンバーガーが持ち、ここは CSS が文字を出し入れするだけ。
 * 畳んでいても同じ要素を保つので、未読数は隠れている間も更新を受け取る。
 */

export { isCurrent };

export function V2NavGroups({
  items,
  currentPath,
  japanese,
}: {
  items: V2NavItem[];
  currentPath: string;
  japanese: boolean;
}) {
  const renderItem = (item: V2NavItem) => (
    <li key={item.href} data-gap={item.gapBefore ? "true" : undefined}>
      <Link
        href={item.href}
        className="v2-nav__item"
        title={item.label}
        aria-current={isCurrent(item.href, currentPath) ? "page" : undefined}
      >
        {item.avatar ? (
          <Avatar className="v2-nav__avatar" size={24} name={item.avatar.name} src={item.avatar.src} alt={item.avatar.name ?? ""} />
        ) : item.icon ? <V2Icon name={item.icon} className="v2-nav__icon" /> : null}
        <span className="v2-nav__label">{item.label}</span>
        {item.live ? (
          <V2NavCount kind={item.live} initial={item.count ?? 0} japanese={japanese} />
        ) : item.count ? (
          <span className="v2-nav__count" aria-label={japanese ? `未読${item.count}件` : `${item.count} unread`}>
            {item.count}
          </span>
        ) : null}
      </Link>
    </li>
  );
  const main = items.filter((item) => !item.bottom);
  const bottom = items.filter((item) => item.bottom);
  return (
    <div className="v2-nav__flat">
      <ul className="v2-nav__flat-main">{main.map(renderItem)}</ul>
      <div className="v2-nav__post-slot"><V2NavPost label={japanese ? "投稿する" : "Compose"} /></div>
      {bottom.length ? <ul className="v2-nav__flat-bottom">{bottom.map(renderItem)}</ul> : null}
    </div>
  );
}
