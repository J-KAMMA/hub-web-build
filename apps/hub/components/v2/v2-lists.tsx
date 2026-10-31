"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";
import type { ListsPageData } from "@/lib/server/lists-page-data";
import type { MusicPlaylistRecord } from "@/lib/server/d1-music-playlists";

/*
 * リスト。既存の saved-lists-hub.tsx から機能だけを抜いた。
 *   プレイリスト: ログインなら D1、未ログインなら端末の music.playlists
 *   コミュニティのリスト: 作る（POST /api/lists）・名前と公開範囲を変える（PATCH）・消す（DELETE）・
 *     スレッドと人を外す（DELETE /api/lists/{id}/threads|profiles/{targetId}）
 * 2つは ?tab= で切り替え、URL に残る。
 */
export type V2ListsTab = "playlists" | "community";
type CommunityList = ListsPageData["lists"][number];
type PlaylistView = Pick<MusicPlaylistRecord, "id" | "title" | "description" | "workIds">;

function readLocalPlaylists(): PlaylistView[] {
  try {
    const value = JSON.parse(window.localStorage.getItem("music.playlists") ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): PlaylistView[] => {
      const record = item as Record<string, unknown>;
      if (!record || typeof record.id !== "string" || typeof record.title !== "string" || !Array.isArray(record.workIds)) return [];
      return [{ id: record.id, title: record.title, description: typeof record.description === "string" ? record.description : "", workIds: record.workIds.filter((id): id is string => typeof id === "string") }];
    });
  } catch {
    return [];
  }
}

export function V2Lists({ tab, playlists, communityLists, focusListId, authenticated, japanese }: {
  tab: V2ListsTab;
  playlists: PlaylistView[];
  communityLists: CommunityList[];
  focusListId?: string | null;
  authenticated: boolean;
  japanese: boolean;
}) {
  const [localPlaylists, setLocalPlaylists] = useState<PlaylistView[]>([]);
  const [serverPlaylists, setServerPlaylists] = useState(playlists);
  const [lists, setLists] = useState(communityLists);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!focusListId || tab !== "community") return;
    const target = document.getElementById(`v2-list-${encodeURIComponent(focusListId)}`);
    if (!(target instanceof HTMLElement)) return;
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }, [focusListId, lists, tab]);

  useEffect(() => {
    setLocalPlaylists(readLocalPlaylists());
  }, []);

  const call = async (url: string, method: string, body?: unknown) => {
    const response = await fetch(url, { method, credentials: "same-origin", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => null) as Record<string, unknown> & { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || String(response.status));
    return payload ?? {};
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    /* await の後は currentTarget が消えるので、先に取っておく。 */
    const element = event.currentTarget;
    const form = new FormData(element);
    const name = String(form.get("name") ?? "").trim();
    if (!name || busy) return;
    setBusy("new");
    try {
      const payload = await call("/api/lists", "POST", { name, description: "", visibility: form.get("visibility") === "public" ? "public" : "private" }) as { list?: CommunityList };
      if (payload.list) setLists((current) => [...current, { ...payload.list!, threadItems: payload.list!.threadItems ?? [], profileItems: payload.list!.profileItems ?? [] }]);
      element.reset();
      setStatus(japanese ? "リストを作りました。" : "List created.");
    } catch (caught) {
      setStatus(caught instanceof Error && caught.message ? caught.message : (japanese ? "リストを作れませんでした。" : "Could not create the list."));
    } finally {
      setBusy(null);
    }
  };

  const rename = async (list: CommunityList, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get("description") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    if (!name || busy) return;
    setBusy(list.id);
    try {
      const visibility = form.get("visibility") === "public" ? "public" : "private";
      await call(`/api/lists/${encodeURIComponent(list.id)}`, "PATCH", { name, description, visibility });
      setLists((current) => current.map((item) => item.id === list.id ? { ...item, name, description, visibility } : item));
      setEditing(null);
      setStatus(japanese ? "保存しました。" : "Saved.");
    } catch (caught) {
      setStatus(caught instanceof Error && caught.message ? caught.message : (japanese ? "保存できませんでした。" : "Could not save."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (list: CommunityList) => {
    if (busy) return;
    if (!window.confirm(japanese ? `「${list.name}」を消しますか。` : `Delete "${list.name}"?`)) return;
    setBusy(list.id);
    try {
      await call(`/api/lists/${encodeURIComponent(list.id)}`, "DELETE");
      setLists((current) => current.filter((item) => item.id !== list.id));
      setStatus(japanese ? "消しました。" : "Deleted.");
    } catch (caught) {
      setStatus(caught instanceof Error && caught.message ? caught.message : (japanese ? "消せませんでした。" : "Could not delete."));
    } finally {
      setBusy(null);
    }
  };

  const removeItem = async (list: CommunityList, kind: "threads" | "profiles", targetId: string) => {
    if (busy) return;
    setBusy(`${list.id}:${targetId}`);
    try {
      await call(`/api/lists/${encodeURIComponent(list.id)}/${kind}/${encodeURIComponent(targetId)}`, "DELETE");
      setLists((current) => current.map((item) => item.id !== list.id ? item : {
        ...item,
        threadIds: kind === "threads" ? item.threadIds.filter((id) => id !== targetId) : item.threadIds,
        profileIds: kind === "profiles" ? item.profileIds.filter((id) => id !== targetId) : item.profileIds,
        threadItems: kind === "threads" ? item.threadItems.filter((entry) => entry.id !== targetId) : item.threadItems,
        profileItems: kind === "profiles" ? item.profileItems.filter((entry) => entry.id !== targetId) : item.profileItems,
      }));
    } catch (caught) {
      setStatus(caught instanceof Error && caught.message ? caught.message : (japanese ? "外せませんでした。" : "Could not remove."));
    } finally {
      setBusy(null);
    }
  };

  const allPlaylists = authenticated ? serverPlaylists : localPlaylists;

  /*
   * プレイリストの作成と削除（2026-09-07、「全部を v2 に」の最後の1つ）。
   * 既存は音楽の画面（music-discovery.tsx）が持っていた。ログインなら
   * POST/DELETE /api/music/playlists、未ログインなら端末の music.playlists
   * （既存と同じ鍵・同じ形。曲を足すのは音楽の画面で、ここは器だけ）。
   */
  const storeLocalPlaylists = (next: PlaylistView[]) => {
    setLocalPlaylists(next);
    try { window.localStorage.setItem("music.playlists", JSON.stringify(next)); } catch { /* 覚えられなくても、その場では使える。 */ }
  };

  const createPlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const title = String(new FormData(element).get("title") ?? "").normalize("NFKC").trim();
    if (!title || title.length > 80 || busy) return;
    setBusy("new-playlist");
    try {
      if (authenticated) {
        const payload = await call("/api/music/playlists", "POST", { title, description: "" }) as { playlist?: PlaylistView };
        if (payload.playlist) setServerPlaylists((current) => [...current, payload.playlist!]);
      } else {
        storeLocalPlaylists([...localPlaylists, { id: `local-${crypto.randomUUID()}`, title, description: "", workIds: [] }]);
      }
      element.reset();
      setStatus(japanese ? `「${title}」を作りました。` : `Created "${title}".`);
    } catch (caught) {
      setStatus(caught instanceof Error && caught.message ? caught.message : (japanese ? "プレイリストを作れませんでした。" : "Could not create the playlist."));
    } finally {
      setBusy(null);
    }
  };

  const removePlaylist = async (playlist: PlaylistView) => {
    if (busy) return;
    if (!window.confirm(japanese ? `「${playlist.title}」を消しますか。` : `Delete "${playlist.title}"?`)) return;
    setBusy(playlist.id);
    try {
      if (authenticated) {
        await call(`/api/music/playlists/${encodeURIComponent(playlist.id)}`, "DELETE");
        setServerPlaylists((current) => current.filter((item) => item.id !== playlist.id));
      } else {
        storeLocalPlaylists(localPlaylists.filter((item) => item.id !== playlist.id));
      }
      setStatus(japanese ? "消しました。" : "Deleted.");
    } catch (caught) {
      setStatus(caught instanceof Error && caught.message ? caught.message : (japanese ? "消せませんでした。" : "Could not delete."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="v2-lists">
      {status ? <p className="v2-note" role="status">{status}</p> : null}

      {tab === "playlists" ? (
        <>
          <form className="v2-lists__new" onSubmit={(event) => void createPlaylist(event)}>
            <input className="v2-tnew__title" type="text" name="title" maxLength={80} required placeholder={japanese ? "新しいプレイリストの名前" : "New playlist name"} aria-label={japanese ? "新しいプレイリストの名前" : "New playlist name"} />
            <V2Button variant="primary" type="submit" label={japanese ? "作る" : "Create"} disabled={busy === "new-playlist"} />
          </form>
          {!authenticated ? <p className="v2-note">{japanese ? "ログインしていないので、この端末に覚えます。" : "Not signed in, so playlists are kept on this device."}</p> : null}
          {allPlaylists.length ? (
            <ul className="v2-tlist">
              {allPlaylists.map((playlist) => (
                <li key={playlist.id} className="v2-tcard">
                  <Link className="v2-tcard__title" href="/v2/music">{playlist.title}</Link>
                  {playlist.description ? <p className="v2-tcard__excerpt">{playlist.description}</p> : null}
                  <p className="v2-tcard__foot">
                    <span>{japanese ? `${playlist.workIds.length}曲` : `${playlist.workIds.length} tracks`}</span>
                    <V2Button icon="trash" label={japanese ? "消す" : "Delete"} disabled={busy === playlist.id} onClick={() => void removePlaylist(playlist)} />
                  </p>
                </li>
              ))}
            </ul>
          ) : <V2Empty title={japanese ? "プレイリストはまだありません" : "No playlists yet"} note={japanese ? "上の欄から作れます。曲は音楽の画面から足します。" : "Create one above. Add tracks from the music screen."} />}
        </>
      ) : null}

      {tab === "community" ? (
        <>
          {authenticated ? (
            <form className="v2-lists__new" onSubmit={create}>
              <input className="v2-tnew__title" type="text" name="name" maxLength={60} required placeholder={japanese ? "新しいリストの名前" : "New list name"} aria-label={japanese ? "新しいリストの名前" : "New list name"} />
              <select name="visibility" defaultValue="private" aria-label={japanese ? "公開範囲" : "Visibility"}>
                <option value="private">{japanese ? "非公開" : "Private"}</option>
                <option value="public">{japanese ? "公開" : "Public"}</option>
              </select>
              <V2Button variant="primary" type="submit" label={japanese ? "作る" : "Create"} disabled={busy === "new"} />
            </form>
          ) : <V2State kind="signedOut" icon="list" compact next="/v2/lists?tab=community" japanese={japanese} note={japanese ? "ログインするとリストを作れます。" : "Sign in to create lists."} />}
          {lists.length ? (
            <ul className="v2-tlist">
              {lists.map((list) => (
                <li id={`v2-list-${encodeURIComponent(list.id)}`} tabIndex={-1} key={list.id} className="v2-tcard">
                  {editing === list.id ? (
                    <form className="v2-lists__edit" onSubmit={(event) => void rename(list, event)}>
                      <input className="v2-tnew__title" type="text" name="name" defaultValue={list.name} maxLength={60} required aria-label={japanese ? "名前" : "Name"} />
                      <input className="v2-tnew__title" type="text" name="description" defaultValue={list.description} maxLength={200} placeholder={japanese ? "説明" : "Description"} aria-label={japanese ? "説明" : "Description"} />
                      <select name="visibility" defaultValue={list.visibility} aria-label={japanese ? "公開範囲" : "Visibility"}>
                        <option value="private">{japanese ? "非公開" : "Private"}</option>
                        <option value="public">{japanese ? "公開" : "Public"}</option>
                      </select>
                      <div className="v2-reply__footer">
                        <V2Button variant="text" label={japanese ? "やめる" : "Cancel"} onClick={() => setEditing(null)} />
                        <V2Button variant="primary" type="submit" label={japanese ? "保存" : "Save"} disabled={busy === list.id} />
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="v2-tcard__title">{list.name} <span className="v2-badge">{list.visibility === "public" ? (japanese ? "公開" : "Public") : (japanese ? "非公開" : "Private")}</span></p>
                      {list.description ? <p className="v2-tcard__excerpt">{list.description}</p> : null}
                    </>
                  )}
                  {list.threadItems.length || list.profileItems.length ? (
                    <ul className="v2-lists__items">
                      {list.threadItems.map((thread) => (
                        <li key={thread.id}>
                          <Link href={thread.href.replace(/^\/threads\//, "/v2/threads/")}>{thread.title}</Link>
                          {authenticated ? <V2Button icon="close" label={japanese ? "リストから外す" : "Remove from list"} disabled={busy === `${list.id}:${thread.id}`} onClick={() => void removeItem(list, "threads", thread.id)} /> : null}
                        </li>
                      ))}
                      {list.profileItems.map((person) => (
                        <li key={person.id}>
                          <Link href={person.href.replace(/^\/profile\//, "/v2/profile/")}>{person.displayName}</Link>
                          {authenticated ? <V2Button icon="close" label={japanese ? "リストから外す" : "Remove from list"} disabled={busy === `${list.id}:${person.id}`} onClick={() => void removeItem(list, "profiles", person.id)} /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="v2-tcard__excerpt">{japanese ? "まだ何も入っていません。" : "Empty."}</p>}
                  {authenticated && editing !== list.id ? (
                    <div className="v2-post__actions">
                      <V2Button icon="edit" label={japanese ? "名前と公開範囲を変える" : "Rename"} onClick={() => setEditing(list.id)} />
                      <V2Button icon="trash" label={japanese ? "消す" : "Delete"} disabled={busy === list.id} onClick={() => void remove(list)} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="v2-note">{japanese ? "コミュニティのリストはまだありません。" : "No community lists yet."}</p>}
        </>
      ) : null}
    </div>
  );
}
