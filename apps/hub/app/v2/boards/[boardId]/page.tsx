import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2ImageBoardView } from "@/components/v2/v2-image-boards";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getReadableImageBoard, listImageBoardItems, listImageBoards } from "@/lib/server/d1-image-boards";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { getHubLocale } from "@/lib/server/locale";
import { getInstanceOrigin } from "@/lib/instance-origin";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ボード | Hub v2",
  robots: { index: false, follow: false },
};

/* 一つのボード。持ち主か、公開にされているときだけ読める。ほかは「無い」と同じ扱い。 */
export default async function V2BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const [{ boardId }, locale, shell] = await Promise.all([params, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const database = getOptionalHubD1();
  if (!database) notFound();
  const request = new Request(`${getInstanceOrigin()}/v2/boards/${encodeURIComponent(boardId)}`, { headers: await headers() });
  const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
  const board = await getReadableImageBoard(database, boardId, viewer?.id ?? null);
  if (!board) notFound();
  const page = await listImageBoardItems(database, boardId, viewer?.id ?? null, null);
  const mine = await (viewer ? listImageBoards(database, viewer.id) : Promise.resolve([]));
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const directory = (
    <ul className="v2-nav__list">
      {mine.map((entry) => (
        <li key={entry.id}>
          <a className="v2-nav__item" href={`/v2/boards/${encodeURIComponent(entry.id)}`} aria-current={entry.id === board.id ? "page" : undefined}>
            <span className="v2-nav__label">{entry.name}</span>
            <span className="v2-nav__count v2-nav__count--quiet">{entry.itemCount}</span>
          </a>
        </li>
      ))}
      <li><a className="v2-nav__item" href="/v2/boards"><span className="v2-nav__label">{japanese ? "ボード一覧" : "All boards"}</span></a></li>
    </ul>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/boards"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ボード" : "Boards"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(viewer)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={board.name} action={<span className="v2-heading__note">{board.isPublic ? (japanese ? "公開" : "Public") : (japanese ? "非公開" : "Private")}</span>} />
      <V2ImageBoardView
        key={`${board.id}:${board.name}`}
        boardId={board.id}
        name={board.name}
        isPublic={board.isPublic}
        mine={board.mine}
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        japanese={japanese}
      />
    </V2Shell>
  );
}
