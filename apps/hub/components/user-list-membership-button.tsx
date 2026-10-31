"use client";

import React, { useState } from "react";
import type { UserList } from "@/lib/domain";
import styles from "./user-list-membership-button.module.css";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

export function UserListMembershipButton({
  kind,
  targetId,
}: {
  kind: "profile" | "thread";
  targetId: string;
}) {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const [lists, setLists] = useState<UserList[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [newName, setNewName] = useState("");
  const [status, setStatus] = useState("");

  async function loadLists() {
    if (lists) return;
    const response = await fetch("/api/lists", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => null) as { lists?: UserList[]; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? "リストを取得できませんでした。");
    setLists(payload?.lists ?? []);
  }

  async function togglePanel() {
    const next = !open;
    setOpen(next);
    setStatus("");
    if (!next) return;
    try {
      await loadLists();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "リストを取得できませんでした。");
    }
  }

  async function setMembership(list: UserList, active: boolean) {
    setBusyId(list.id);
    setStatus("");
    try {
      const segment = kind === "profile" ? "profiles" : "threads";
      const response = await fetch(
        `/api/lists/${encodeURIComponent(list.id)}/${segment}/${encodeURIComponent(targetId)}`,
        { method: active ? "PUT" : "DELETE", credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "リストを更新できませんでした。");
      setLists((current) => (current ?? []).map((item) => item.id === list.id
        ? {
            ...item,
            profileIds: kind === "profile"
              ? active
                ? [...new Set([...item.profileIds, targetId])]
                : item.profileIds.filter((id) => id !== targetId)
              : item.profileIds,
            threadIds: kind === "thread"
              ? active
                ? [...new Set([...item.threadIds, targetId])]
                : item.threadIds.filter((id) => id !== targetId)
              : item.threadIds,
          }
        : item));
      setStatus(active ? "リストに追加しました。" : "リストから外しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "リストを更新できませんでした。");
    } finally {
      setBusyId("");
    }
  }

  async function createList() {
    const name = newName.trim();
    if (!name) return;
    setBusyId("new");
    setStatus("");
    try {
      const response = await fetch("/api/lists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: "", visibility: "private" }),
      });
      const payload = await response.json().catch(() => null) as { list?: UserList; error?: string } | null;
      if (!response.ok || !payload?.list) throw new Error(payload?.error ?? "リストを作成できませんでした。");
      setLists((current) => [...(current ?? []), payload.list!]);
      setNewName("");
      await setMembership(payload.list, true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "リストを作成できませんでした。");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className={styles.root}>
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => void togglePanel()}>
        <span aria-hidden="true">☷</span>
        リスト
      </button>
      {open ? (
        <div className={styles.panel}>
          <strong>リストに保存</strong>
          {lists?.length ? (
            <ul>
              {lists.map((list) => {
                const active = (kind === "profile" ? list.profileIds : list.threadIds).includes(targetId);
                return (
                  <li key={list.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={Boolean(busyId)}
                        onChange={(event) => void setMembership(list, event.currentTarget.checked)}
                      />
                      <span>{list.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : lists ? <p>リストはまだありません。</p> : <p>読み込み中…</p>}
          <div className={styles.create}>
            <input
              value={newName}
              maxLength={100}
              onChange={(event) => setNewName(event.currentTarget.value)}
              placeholder="新しいリスト名"
              aria-label="新しいリスト名"
            />
            <button type="button" disabled={!newName.trim() || Boolean(busyId)} onClick={() => void createList()}>
              作成
            </button>
          </div>
          {status ? <p className={styles.status} role="status">{status}</p> : null}
          <a href={hubSurfacePath(surface, "/lists?tab=community")}>リストを管理</a>
        </div>
      ) : null}
    </div>
  );
}
