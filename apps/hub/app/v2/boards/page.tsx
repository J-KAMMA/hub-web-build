import type { Metadata } from "next";
import { headers } from "next/headers";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2ImageBoardList } from "@/components/v2/v2-image-boards";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listImageBoards, type ImageBoard } from "@/lib/server/d1-image-boards";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { getHubLocale } from "@/lib/server/locale";
import { getInstanceOrigin } from "@/lib/instance-origin";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ボード | Hub v2",
};

/* 画像検索で保存した画像のボード。自分のボードだけをここに並べる (公開ボードは直接のリンクで読める)。 */
export default async function V2BoardsPage() {
  const [locale, shell] = await Promise.all([getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const database = getOptionalHubD1();
  let boards: ImageBoard[] = [];
  let signedIn = false;
  if (database) {
    try {
      const request = new Request(`${getInstanceOrigin()}/v2/boards`, { headers: await headers() });
      const viewer = await getOptionalHubSessionProfile(request, database);
      signedIn = Boolean(viewer);
      boards = viewer ? await listImageBoards(database, viewer.id) : [];
    } catch {
      /* ボードが取れなければ空として出す。 */
    }
  }
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const directory = (
    <ul className="v2-nav__list">
      <li><a className="v2-nav__item" href="/v2/boards" aria-current="page"><span className="v2-nav__label">{japanese ? "ボード" : "Boards"}</span><span className="v2-nav__count v2-nav__count--quiet">{boards.length}</span></a></li>
      <li><a className="v2-nav__item" href="/v2/search?group=images"><span className="v2-nav__label">{japanese ? "画像を探す" : "Find images"}</span></a></li>
      <li><a className="v2-nav__item" href="/v2/bookmarks"><span className="v2-nav__label">{japanese ? "ブックマーク" : "Bookmarks"}</span></a></li>
    </ul>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/boards"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ボード" : "Boards"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={signedIn} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "ボード" : "Boards"} />
      {signedIn ? (
        <V2ImageBoardList
          boards={boards.map((board) => ({ id: board.id, name: board.name, isPublic: board.isPublic, itemCount: board.itemCount, coverUrl: board.coverUrl }))}
          japanese={japanese}
        />
      ) : (
        <V2State kind="signedOut" icon="bookmark" next="/v2/boards" japanese={japanese} note={japanese ? "ログインすると、画像のボードを作れます。" : "Sign in to make image boards."} />
      )}
    </V2Shell>
  );
}
