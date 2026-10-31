"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/v2/ui/button";
import { V2ImageDetail, V2ImageMasonry, useInfiniteSentinel } from "@/components/v2/v2-image-grid";
import type { ImageItem } from "@/lib/image-search";
import "@/app/v2/v2-image-search.css";

export type BoardCard = { id: string; name: string; isPublic: boolean; itemCount: number; coverUrl: string | null };
export type BoardViewItem = ImageItem & { itemId: string };

/* /v2/boards: 自分のボードの一覧と、新しいボードを作る欄。 */
export function V2ImageBoardList({ boards, japanese }: { boards: BoardCard[]; japanese: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/image-boards", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isPublic: false }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? (japanese ? "ボードを作れませんでした。" : "Could not create the board."));
        return;
      }
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-imgs-page">
      <form className="v2-boards__create" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="ui-sr" htmlFor="v2-boards-name">{japanese ? "新しいボードの名前" : "New board name"}</label>
        <input id="v2-boards-name" className="v2-boards__input" value={name} maxLength={60} placeholder={japanese ? "新しいボードの名前" : "New board name"} onChange={(event) => setName(event.target.value)} />
        <Button variant="primary" type="submit" label={japanese ? "ボードを作る" : "Create board"} disabled={busy || !name.trim()} />
      </form>
      {message ? <p className="v2-boards__status" role="alert">{message}</p> : null}
      {boards.length ? (
        <ul className="v2-boards" aria-label={japanese ? "ボード" : "Boards"}>
          {boards.map((board) => (
            <li key={board.id}>
              <Link className="v2-boards__card" href={`/v2/boards/${encodeURIComponent(board.id)}`}>
                <span className="v2-boards__cover" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {board.coverUrl ? <img src={board.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                </span>
                <span className="v2-boards__name">{board.name}</span>
                <span className="v2-boards__sub">{board.isPublic ? (japanese ? "公開" : "Public") : (japanese ? "非公開" : "Private")} / {japanese ? `${board.itemCount}枚` : board.itemCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="v2-note">{japanese ? "ボードはまだありません。画像検索で気に入った画像を保存すると、ここに並びます。" : "No boards yet. Save images from image search to start one."}</p>
      )}
    </div>
  );
}

/* /v2/boards/[id]: 同じ敷き詰め表示。持ち主には名前・公開・削除・画像を外す操作が付く。 */
export function V2ImageBoardView({
  boardId,
  name,
  isPublic,
  mine,
  initialItems,
  initialCursor,
  japanese,
}: {
  boardId: string;
  name: string;
  isPublic: boolean;
  mine: boolean;
  initialItems: BoardViewItem[];
  initialCursor: string | null;
  japanese: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<BoardViewItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ImageItem | null>(null);
  const [title, setTitle] = useState(name);
  const [publicNow, setPublicNow] = useState(isPublic);
  const [message, setMessage] = useState("");
  const busy = useRef(false);

  const more = useCallback(async () => {
    if (busy.current || !cursor) return;
    busy.current = true;
    setLoading(true);
    try {
      const response = await fetch(`/api/image-boards/${encodeURIComponent(boardId)}?cursor=${encodeURIComponent(cursor)}`, { credentials: "same-origin" });
      if (!response.ok) { setCursor(null); return; }
      const body = (await response.json()) as { items: BoardViewItem[]; nextCursor: string | null };
      setItems((current) => {
        const seen = new Set(current.map((item) => item.itemId));
        return [...current, ...body.items.filter((item) => !seen.has(item.itemId))];
      });
      setCursor(body.nextCursor);
    } catch {
      setCursor(null);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [boardId, cursor]);
  const sentinel = useInfiniteSentinel(() => void more(), Boolean(cursor) && !loading);

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/image-boards/${encodeURIComponent(boardId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(error.error ?? (japanese ? "変更できませんでした。" : "Could not update."));
      return false;
    }
    setMessage("");
    return true;
  };

  const remove = async (item: BoardViewItem) => {
    const response = await fetch(`/api/image-boards/${encodeURIComponent(boardId)}/items?itemId=${encodeURIComponent(item.itemId)}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) setItems((current) => current.filter((entry) => entry.itemId !== item.itemId));
    else setMessage(japanese ? "外せませんでした。" : "Could not remove.");
  };

  return (
    <div className="v2-imgs-page">
      {mine ? (
        <div className="v2-boards__bar">
          <label className="ui-sr" htmlFor="v2-board-name">{japanese ? "ボード名" : "Board name"}</label>
          <input id="v2-board-name" className="v2-boards__input" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
          <Button variant="secondary" label={japanese ? "名前を変える" : "Rename"} disabled={!title.trim() || title.trim() === name} onClick={() => void patch({ name: title }).then((ok) => { if (ok) router.refresh(); })} />
          <Button
            variant="secondary"
            label={publicNow ? (japanese ? "公開中（非公開にする）" : "Public (make private)") : (japanese ? "非公開（公開する）" : "Private (make public)")}
            pressed={publicNow}
            onClick={() => void patch({ isPublic: !publicNow }).then((ok) => { if (ok) setPublicNow(!publicNow); })}
          />
          <Button
            variant="danger"
            label={japanese ? "ボードを削除" : "Delete board"}
            onClick={() => {
              if (!window.confirm(japanese ? "このボードを削除します。保存した画像の一覧も消えます。" : "Delete this board and its saved list?")) return;
              void fetch(`/api/image-boards/${encodeURIComponent(boardId)}`, { method: "DELETE", credentials: "same-origin" }).then((response) => {
                if (response.ok) router.push("/v2/boards");
                else setMessage(japanese ? "削除できませんでした。" : "Could not delete.");
              });
            }}
          />
        </div>
      ) : null}
      {message ? <p className="v2-boards__status" role="alert">{message}</p> : null}
      {items.length ? (
        <V2ImageMasonry
          items={items}
          japanese={japanese}
          label={japanese ? "ボードの画像" : "Board images"}
          onOpen={setDetail}
          extra={mine ? (item) => <Button variant="plain" label={japanese ? "外す" : "Remove"} onClick={() => void remove(item as BoardViewItem)} /> : undefined}
        />
      ) : (
        <p className="v2-note">{japanese ? "このボードにはまだ画像がありません。" : "This board has no images yet."}</p>
      )}
      {cursor ? (
        <div ref={sentinel} className="v2-imgsearch__more">
          <Button variant="secondary" label={japanese ? "もっと見る" : "Show more"} busy={loading} onClick={() => void more()} />
        </div>
      ) : null}
      <V2ImageDetail item={detail} japanese={japanese} onClose={() => setDetail(null)} onPick={setDetail} />
    </div>
  );
}
