import type { ReactNode } from "react";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2PageHeader } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

/*
 * 既存の部品を1つ置くだけの画面（クリエイター・収益・ノード・計算・意図・ストア・
 * Vault・AI・音楽のライブラリ／履歴／スタジオ）の共通の枠。
 * 部品が見出しを持つなら枠の見出しを省く。本体が広い前提なら右列を出さない。
 */
export async function V2PanelPage({ currentPath, title, note, panelOwnsHeading = false, wide = false, directoryTitle, directory, directoryRail, skin, children }: {
  currentPath: string;
  title: string;
  note?: ReactNode;
  panelOwnsHeading?: boolean;
  wide?: boolean;
  directoryTitle?: ReactNode;
  directory?: ReactNode;
  directoryRail?: ReactNode;
  skin?: "luxe";
  children: ReactNode;
}) {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  return (
    <V2Shell skin={skin}
      currentPath={currentPath}
      pageTitle={title}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={directoryTitle}
      directory={directory}
      directoryRail={directoryRail}
      aside={wide ? undefined : <V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2PageHeader panelOwnsHeading={panelOwnsHeading} title={title} action={note ? <span className="v2-heading__note">{note}</span> : undefined} />
      <div className="v2-account__panels v2-market__panels">
        {children}
      </div>
    </V2Shell>
  );
}
