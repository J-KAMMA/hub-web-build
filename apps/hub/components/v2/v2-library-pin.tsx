"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { V2Icon } from "@/components/v2/v2-icons";
import type { LibrarySection } from "@/lib/library-column";

/* 固定の押し手。保存は PUT /api/account/library-pins、成功したら列を読み直して並びを入れ替える。 */
export function V2LibraryPin({ section, itemKey, label, pinned, japanese }: { section: LibrarySection; itemKey: string; label: string; pinned: boolean; japanese: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const next = !pinned;
  const name = pinned ? (japanese ? `${label}の固定を外す` : `Unpin ${label}`) : (japanese ? `${label}を上に固定` : `Pin ${label} to top`);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/account/library-pins", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, key: itemKey, pinned: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="v2-lib__pin" aria-pressed={pinned} aria-label={name} title={failed ? (japanese ? "保存できませんでした" : "Could not save") : name} data-failed={failed ? "true" : undefined} disabled={busy} onClick={toggle}>
      <V2Icon name="pin" />
    </button>
  );
}

/* カートはこの端末の localStorage にある（Hub の DB には無い）。件数だけを読む。 */
const CART_KEY = "hub.shopping.cart.v1";
export function V2LibraryCartCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(CART_KEY) ?? "[]") as unknown;
      setCount(Array.isArray(value) ? value.length : 0);
    } catch {
      setCount(null);
    }
  }, []);
  return count ? <span className="v2-lib__count">{count > 99 ? "99+" : count}</span> : null;
}
