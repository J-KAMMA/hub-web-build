import type { Metadata } from "next";
import Link from "next/link";

import { HubWorld } from "@/components/hub-world";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { WorldServers } from "@/components/world-servers";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { worldAddress, worldAssets } from "@/lib/server/world-origin";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../../world.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "3Dワールド | Hub v2" };

/* サーバの名前の形。宛先の一部になるので、頁の側でも見る（既存と同じ）。 */
const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/u;

/*
 * 3D の世界。既存の /world から機能だけを抜いた: 既定の世界へ入る、?server= で第三者の
 * サーバへ繋ぐ（**繋ぎ先は名簿から引き、公開のものだけ**）、主の名前と注意。
 * 描画は既存の HubWorld と WorldServers をそのまま。画面が要るときは列を畳んで使う
 * （2026-09-19、全面4領域化で内側左列と右列を持たせた）。
 */
export default async function V2WorldPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const [{ server: asked }, locale, shell] = await Promise.all([searchParams, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const server = typeof asked === "string" && NAME.test(asked) ? asked : null;
  let address = worldAddress();
  let host: { title: string; operator: string } | null = null;
  const database = getOptionalHubD1();
  if (server && database) {
    const row = await database
      .prepare(`SELECT s.title, s.address, s.status, p.display_name AS operatorName
        FROM WorldServer s LEFT JOIN profiles p ON p.id = s.operatorId
        WHERE s.name = ? LIMIT 1`)
      .bind(server)
      .first<{ title: string; address: string; status: string; operatorName: string | null }>()
      .catch(() => null);
    if (row && row.status === "公開") {
      address = row.address;
      host = { title: row.title, operator: row.operatorName ?? (japanese ? "不明" : "unknown") };
    }
  }
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "世界" : "World"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/world"><span className="v2-nav__label">{japanese ? "既定の世界" : "Default world"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/world/servers"><span className="v2-nav__label">{japanese ? "サーバ一覧" : "Servers"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      currentPath="/v2/world"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "世界" : "World"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "3Dワールド" : "3D world"} action={host ? <span className="v2-heading__note">{host.title}</span> : undefined} />
      {host ? (
        <p className="v2-note" role="note">
          <strong>{host.title}</strong>（{japanese ? "主" : "host"}: {host.operator}）{japanese ? "に入っています。ここは他の人が動かしているサーバで、場所と発言は主に見えます。" : ". This server is run by someone else; your position and speech are visible to the host."}
        </p>
      ) : null}
      <div className="v2-account__panels v2-market__panels">
        <HubWorld address={address} assets={worldAssets()} server={host ? server : null} />
        <WorldServers current={server} preferV2 />
      </div>
    </V2Shell>
  );
}
