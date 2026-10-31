"use client";

import { useEffect, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";

/*
 * ナビの下のテーマ切替。設定の画面（v2-settings-display.tsx）と同じ鍵と同じ
 * イベントで動く: localStorage の hub.theme、html の data-theme、hub:theme-change。
 * 押すたびに 端末に合わせる → 明るい → 暗い と回る。
 */
type Theme = "auto" | "light" | "dark";
const ORDER: Theme[] = ["auto", "light", "dark"];

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function V2NavTheme({ japanese }: { japanese: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hub.theme");
      if (saved === "light" || saved === "dark" || saved === "auto") setTheme(saved);
    } catch {
      /* 読めなければ既定のまま。 */
    }
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    const resolved = next === "auto" ? (systemPrefersDark() ? "dark" : "light") : next;
    setTheme(next);
    try {
      window.localStorage.setItem("hub.theme", next);
    } catch {
      /* 覚えられなくても、その場では効く。 */
    }
    document.documentElement.dataset.theme = resolved;
    window.dispatchEvent(new CustomEvent("hub:theme-change", { detail: resolved }));
  };

  const label = theme === "auto"
    ? (japanese ? "テーマ: 端末に合わせる" : "Theme: system")
    : theme === "light"
      ? (japanese ? "テーマ: 明るい" : "Theme: light")
      : (japanese ? "テーマ: 暗い" : "Theme: dark");

  return <V2Button variant="text" label={label} title={japanese ? "押すと切り替わる" : "Press to switch"} onClick={cycle} className="v2-nav__theme" />;
}
