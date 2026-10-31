"use client";

import { useEffect } from "react";

import { v2SettingsAnchorFor } from "@/lib/settings-section-href";

/*
 * 既存の錨を v2 の錨に読み替える（2026-09-07、旦那様の「全部を v2 に」）。
 *
 * /settings は v2 へ転送するようになった。転送で残るのは道と検索文字列だけで、
 * `#storage` のような錨はブラウザが手元で付け直す。v2 の錨は
 * `#v2-settings-storage` なので、そのままでは節に着かず画面の頭に落ちる。
 * サーバーは錨を見られない（送られてこない）。ここでしか読み替えられない。
 *
 * account だけは v2 に同じ節が無く、別の画面（/v2/account）に在る。
 * そこへ送る（2026-09-08）。ほかの知らない錨は触らない。頭に落ちるだけで、
 * 壊れはしない。
 */
export function V2SettingsAnchor() {
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || hash.startsWith("v2-settings-")) return;
    if (hash === "account") {
      window.location.replace("/v2/account");
      return;
    }
    const target = v2SettingsAnchorFor(hash);
    if (!target || !document.getElementById(target)) return;
    window.history.replaceState(window.history.state, "", `#${target}`);
    document.getElementById(target)?.scrollIntoView();
  }, []);
  return null;
}
