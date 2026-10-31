"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/v2/ui/button";
import { Sheet } from "@/components/v2/ui/sheet";
import type { ImageItem } from "@/lib/image-search";
import "@/app/v2/v2-image-search.css";

type BoardSummary = { id: string; name: string; isPublic: boolean; itemCount: number };

/* Browser-side body for POST /api/image-boards/:id/items. Hub-owned kinds are re-read on the server. */
export function savePayload(item: ImageItem) {
  return {
    kind: item.kind,
    ref: item.ref,
    thumbnailUrl: item.thumbnailUrl,
    sourceUrl: item.sourceUrl,
    licence: item.licence,
    title: item.title,
    width: item.width,
    height: item.height,
  };
}

/*
 * 画像をボードに保存する (2026-10-29)。ボードは本人だけのもの。公開にするかどうかはボードの設定で、
 * ここでは選んで保存するだけ。未ログインならログインへ案内する。
 */
export function V2ImageSaveSheet({
  item,
  signedIn,
  japanese,
  onClose,
  fetcher,
}: {
  item: ImageItem | null;
  signedIn: boolean;
  japanese: boolean;
  onClose: () => void;
  fetcher?: typeof fetch;
}) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = fetcher ?? (typeof fetch === "function" ? fetch : undefined);
  const key = item?.key ?? null;

  useEffect(() => {
    setMessage("");
    setName("");
    if (!item || !signedIn || !run) return;
    let live = true;
    void run("/api/image-boards", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { boards?: BoardSummary[] } | null) => {
        if (live) setBoards(body?.boards ?? []);
      })
      .catch(() => { if (live) setBoards([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signedIn]);

  if (!item) return null;

  const save = async (boardId: string, boardName: string) => {
    if (!run || busy) return;
    setBusy(true);
    try {
      const response = await run(`/api/image-boards/${encodeURIComponent(boardId)}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload(item)),
      });
      const body = (await response.json().catch(() => ({}))) as { alreadySaved?: boolean; error?: string };
      if (!response.ok) setMessage(body.error ?? (japanese ? "保存できませんでした。" : "Could not save."));
      else if (body.alreadySaved) setMessage(japanese ? `「${boardName}」には保存済みです。` : `Already saved to "${boardName}".`);
      else setMessage(japanese ? `「${boardName}」に保存しました。` : `Saved to "${boardName}".`);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!run || busy || !name.trim()) return;
    setBusy(true);
    try {
      const response = await run("/api/image-boards", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isPublic: false }),
      });
      const body = (await response.json().catch(() => ({}))) as { board?: BoardSummary; error?: string };
      if (!response.ok || !body.board) {
        setMessage(body.error ?? (japanese ? "ボードを作れませんでした。" : "Could not create the board."));
        return;
      }
      setBoards((current) => [body.board!, ...(current ?? [])]);
      setName("");
    } finally {
      setBusy(false);
    }
    // saving after creation is a separate step so a failed save never hides the new board
  };

  return (
    <Sheet open onClose={onClose} title={japanese ? "ボードに保存" : "Save to board"}>
      {!signedIn ? (
        <p className="v2-imgsave__note">
          {japanese ? "ボードに保存するにはログインが必要です。" : "Sign in to save images to a board."}{" "}
          <a href={`/v2/auth?next=${encodeURIComponent("/v2/search?group=images")}`}>{japanese ? "ログイン" : "Sign in"}</a>
        </p>
      ) : (
        <div className="v2-imgsave">
          {boards === null ? <p className="v2-imgsave__note">{japanese ? "読み込んでいます" : "Loading"}</p> : null}
          {boards && boards.length === 0 ? <p className="v2-imgsave__note">{japanese ? "ボードはまだありません。名前をつけて作ります。" : "No boards yet. Name one to create it."}</p> : null}
          {boards && boards.length > 0 ? (
            <ul className="v2-imgsave__list">
              {boards.map((board) => (
                <li key={board.id}>
                  <button type="button" className="v2-imgsave__row" disabled={busy} onClick={() => void save(board.id, board.name)}>
                    <span className="v2-imgsave__name">{board.name}</span>
                    <span className="v2-imgsave__count">{board.isPublic ? (japanese ? "公開" : "Public") : (japanese ? "非公開" : "Private")} / {board.itemCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="v2-imgsave__create"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="v2-imgsave__label" htmlFor="v2-imgsave-name">{japanese ? "新しいボード" : "New board"}</label>
            <input id="v2-imgsave-name" className="v2-imgsave__input" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
            <Button variant="secondary" type="submit" label={japanese ? "作る" : "Create"} disabled={busy || !name.trim()} />
          </form>
          {message ? <p className="v2-imgsave__note" role="status">{message}</p> : null}
        </div>
      )}
    </Sheet>
  );
}
