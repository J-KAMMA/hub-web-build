import type { ReactNode } from "react";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../app/v2/v2.css";
import "./code-ui.css";

/* コード置き場の画面の枠。見出しは本文が持つので、枠の上端には画面名だけを置く。 */
export async function CodeShell({ title, children }: { title: string; children: (viewer: { profileId: string }) => ReactNode | Promise<ReactNode> }) {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const profile = shell.currentProfile;
  return (
    <V2Shell
      currentPath="/v2/code"
      profile={profile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(profile.id)} viewerId={profile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={title} />
      <div className="hub-code">{await children({ profileId: profile.id })}</div>
    </V2Shell>
  );
}
