import { NextResponse } from "next/server";

import { buildBoardCatalog, getBoardGroups } from "@/lib/bbs-board-catalog";

/**
 * クライアント向けの板一覧。スレッド作成フォームの投稿先選択に使う。
 * Web版 /v2/bbs と同じ静的カタログ（bbs-board-catalog）を返す——
 * D1のboardsテーブルは埋め込み板用で、作成先の板ではない。
 */
export async function GET() {
  const catalog = buildBoardCatalog();
  const groups = getBoardGroups(catalog);
  return NextResponse.json(
    {
      boards: catalog.map((board) => ({ key: board.key, title: board.title })),
      groups: groups.map((group) => ({
        key: group.key,
        name: group.name,
        boards: group.boards.map((board) => ({ key: board.key, title: board.title })),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
