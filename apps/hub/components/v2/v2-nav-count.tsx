"use client";

import { useEffect, useState } from "react";

import { MESSAGE_UNREAD_EVENT, NOTIFICATION_UNREAD_EVENT } from "@/lib/notification-client";

/*
 * ナビの未読数。最初の値はサーバーが渡し、あとは全体のイベントで動く。
 * 既存のシェルも同じイベントを購読していた（表の規則: 未読数は
 * NOTIFICATION_UNREAD_EVENT で全体と同期）。これが無いと、通知を既読にしても
 * ナビの数が頁を移るまで変わらない（2026-09-02 に実際そうだった）。
 */
export function V2NavCount({ kind, initial, japanese }: { kind: "notifications" | "messages"; initial: number; japanese: boolean }) {
  /* 関数はサーバーから渡せない（クライアント境界）。文言はここで組む。 */
  const label = (value: number) => (japanese ? `未読${value}件` : `${value} unread`);
  const [count, setCount] = useState(initial);
  useEffect(() => {
    let generation = 0;
    const name = kind === "notifications" ? NOTIFICATION_UNREAD_EVENT : MESSAGE_UNREAD_EVENT;
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (Number.isFinite(next)) {
        generation += 1;
        setCount(Math.max(0, Math.trunc(next)));
      }
    };
    window.addEventListener(name, onChange);
    /* イベントが来ない間も、30秒ごとに数だけ取り直す（既存と同じ間隔）。見えていないタブでは取らない。 */
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const requestGeneration = ++generation;
      fetch("/api/activity/counts", { cache: "no-store", credentials: "same-origin" })
        .then((response) => {
          if (requestGeneration !== generation || !response.ok) return null;
          return response.json();
        })
        .then((payload: { notificationCount?: number; messageCount?: number } | null) => {
          if (requestGeneration !== generation) return;
          const next = kind === "notifications" ? payload?.notificationCount : payload?.messageCount;
          if (typeof next === "number") setCount(Math.max(0, Math.trunc(next)));
        })
        .catch(() => undefined);
    }, 30_000);
    return () => {
      generation += 1;
      window.removeEventListener(name, onChange);
      window.clearInterval(timer);
    };
  }, [kind]);
  if (!count) return null;
  return <span className="v2-nav__count" aria-label={label(count)}>{count}</span>;
}
