import type { ReactNode } from "react";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import type { AppShellData } from "@/lib/server/app-shell-data";
import { v2NavItems } from "@/lib/v2-nav";

import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

import "@/app/v2/v2.css";

/* 指名依頼の4画面が共有する枠。ナビの内側の列に「依頼」「受付設定」を並べる。 */
export function CommissionsFrame({
  currentPath,
  title,
  japanese,
  shell,
  signedIn,
  children,
}: {
  currentPath: string;
  title: string;
  japanese: boolean;
  shell: AppShellData;
  signedIn: boolean;
  children: ReactNode;
}) {
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const link = (href: string, label: string) => (
    <li>
      <a className="v2-nav__item" href={href} aria-current={currentPath === href ? "page" : undefined}>
        <span className="v2-nav__label">{label}</span>
      </a>
    </li>
  );
  const directory = (
    <ul className="v2-nav__list">
      {link("/v2/commissions", japanese ? "依頼" : "Requests")}
      {link("/v2/commissions/settings", japanese ? "受付設定" : "Offer settings")}
    </ul>
  );
  return (
    <V2Shell skin="luxe"
      currentPath={currentPath}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "依頼" : "Commissions"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={signedIn} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={title} />
      {children}
    </V2Shell>
  );
}
