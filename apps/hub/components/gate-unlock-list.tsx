"use client";

import { useCallback, useEffect, useState } from "react";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import styles from "./purchased-library.module.css";

/* 入手した作品 (2026-10-26)。本人だけの一覧。題名とリンクだけで、開くときは通常のゲート検査が走る。 */

type Item = {
  targetType: "post" | "article" | "video" | "thread";
  targetId: string;
  title: string | null;
  postedAt: string | null;
  lastOpenedAt: string;
  state: "gated" | "open" | "gone";
  href: string | null;
};

type Page = { items: Item[]; nextCursor: string | null };

const KIND: Record<Item["targetType"], string> = { post: "投稿", article: "記事", video: "動画", thread: "スレッド" };
const ENDPOINT = "/api/account/gate-unlocks";

function label(item: Item): string {
  if (item.state === "gone") return "削除された作品";
  if (item.targetType === "post") return `投稿 ${(item.postedAt ?? item.lastOpenedAt).slice(0, 10)}`;
  return item.title && item.title.trim() ? item.title : KIND[item.targetType];
}

export function GateUnlockList() {
  const surface = useHubUiSurface();
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signedOut" | "error">("loading");
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (next: string | null) => {
    try {
      const response = await fetch(next ? `${ENDPOINT}?cursor=${next}` : ENDPOINT, { cache: "no-store" });
      if (response.status === 401) return setState("signedOut");
      if (!response.ok) return setState("error");
      const page = (await response.json()) as Page;
      setItems((current) => (next ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  async function remove(item: Item) {
    setBusy(true);
    try {
      const response = await fetch(`${ENDPOINT}?type=${item.targetType}&id=${encodeURIComponent(item.targetId)}`, { method: "DELETE" });
      if (response.ok) setItems((current) => current.filter((entry) => entry !== item));
      else setState("error");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    try {
      const response = await fetch(`${ENDPOINT}?all=1`, { method: "DELETE" });
      if (response.ok) {
        setItems([]);
        setCursor(null);
        setConfirmClear(false);
      } else setState("error");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.unlocks} aria-labelledby="gate-unlocks-title">
    <div className={styles.sectionHeading}>
      <h2 id="gate-unlocks-title">入手した作品</h2>
      <span>自分だけに表示されます</span>
    </div>
    {state === "loading" ? <p className={styles.helper} role="status">読み込み中…</p> : null}
    {state === "signedOut" ? <p className={styles.helper}>ログインすると、開いた作品がここに並びます。</p> : null}
    {state === "error" ? <p className={`${styles.notice} ${styles.noticeError}`} role="status">読み込めませんでした。もう一度お試しください。</p> : null}
    {state === "ready" && items.length === 0 ? <p className={styles.helper}>まだありません。ゲート付きの作品を開くと、ここに残ります。</p> : null}
    {items.length > 0 ? <ul className={styles.unlockList}>
      {items.map((item) => <li key={`${item.targetType}:${item.targetId}`} className={styles.unlockRow}>
        <div className={styles.unlockCopy}>
          <span className={styles.category}>{KIND[item.targetType]}{item.state === "open" ? " ・ ゲートなし" : ""}</span>
          {item.href
            ? <a className={styles.unlockTitle} href={hubSurfacePath(surface, item.href)}>{label(item)}</a>
            : <span className={styles.unlockTitle}>{label(item)}</span>}
          <time className={styles.helper} dateTime={item.lastOpenedAt}>{item.lastOpenedAt.slice(0, 10)} に開きました</time>
        </div>
        <button className={styles.unlockRemove} type="button" disabled={busy} onClick={() => void remove(item)}>一覧から消す</button>
      </li>)}
    </ul> : null}
    {cursor ? <button className={styles.unlockRemove} type="button" onClick={() => void load(cursor)}>さらに表示</button> : null}
    {items.length > 0 ? (confirmClear
      ? <p className={styles.helper}>すべて消します。作品そのものは消えません。{" "}
          <button className={styles.unlockRemove} type="button" disabled={busy} onClick={() => void clearAll()}>消す</button>{" "}
          <button className={styles.unlockRemove} type="button" onClick={() => setConfirmClear(false)}>やめる</button></p>
      : <button className={styles.unlockRemove} type="button" onClick={() => setConfirmClear(true)}>すべて消す</button>) : null}
    <p className={styles.boundary}>この一覧は閲覧の権利を表しません。開くたびに、いまの条件で確かめます。</p>
  </section>;
}
