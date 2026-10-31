"use client";

import { useEffect, useState, type ReactNode } from "react";

import { clearStoredDisplayPreferences } from "@/components/settings-panel";
import { Segmented } from "@/components/v2/ui/segmented";
import { Sheet } from "@/components/v2/ui/sheet";
import { Switch } from "@/components/v2/ui/switch";
import { V2Icon } from "@/components/v2/v2-icons";

/*
 * 表示の設定。既存の settings-panel.tsx の表示の区画から機能だけを抜いた。
 *
 * 落としてはいけない規則（表）: 値は localStorage の hub.* に保存し、
 * hub:theme-change などのイベントを必ず発火する。他の画面がそれを購読している。
 * 鍵・値・イベント名は既存と1字も変えない。
 */

type Theme = "auto" | "dark" | "light";
type Accent = "gold" | "blue" | "purple" | "pink" | "orange" | "green" | "graphite";
type TextSize = "standard" | "large";
type FeedDensity = "standard" | "compact" | "media";

const ACCENT_LABELS_JA: Record<Accent, string> = { gold: "ゴールド", blue: "青", purple: "紫", pink: "ピンク", orange: "オレンジ", green: "緑", graphite: "グラファイト" };
const ACCENTS: Accent[] = ["gold", "blue", "purple", "pink", "orange", "green", "graphite"];

function systemPrefersDark() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/* 黒金・白黒の両配色が強調色を固定しているあいだは false。保存された強調色の値は触らない。 */
const SHOW_ACCENT_ROW = false;

function store(name: string, value: string) {
  try { localStorage.setItem(name, value); } catch { /* 端末に書けなくても続ける */ }
}

export function V2SettingsDisplay({ locale }: { locale: string }) {
  const ja = locale === "ja";
  const [theme, setTheme] = useState<Theme>("auto");
  const [accent, setAccent] = useState<Accent>("gold");
  const [palette, setPalette] = useState<"default" | "gold-ivory">("gold-ivory");
  const [textSize, setTextSize] = useState<TextSize>("standard");
  const [compact, setCompact] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [density, setDensity] = useState<FeedDensity>("standard");
  const [saved, setSaved] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("hub.theme");
      setTheme(savedTheme === "light" || savedTheme === "auto" ? savedTheme : "dark");
      setPalette(localStorage.getItem("hub.palette") === "default" ? "default" : "gold-ivory");
      const savedAccent = localStorage.getItem("hub.accent");
      setAccent(ACCENTS.includes(savedAccent as Accent) ? savedAccent as Accent : "gold");
      setTextSize(localStorage.getItem("hub.text-size") === "large" ? "large" : "standard");
      setCompact(localStorage.getItem("hub.compact") === "true");
      setReduceMotion(localStorage.getItem("hub.reduce-motion") === "true");
      setRightOpen(localStorage.getItem("hub.right-open") !== "false");
      const storedDensity = localStorage.getItem("hub.feed-density");
      setDensity(storedDensity === "compact" || storedDensity === "media" ? storedDensity : "standard");
    } catch { /* 読めなければ既定のまま */ }
  }, []);

  const confirm = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const changeTheme = (value: Theme) => {
    const resolved = value === "auto" ? (systemPrefersDark() ? "dark" : "light") : value;
    setTheme(value);
    store("hub.theme", value);
    document.documentElement.dataset.theme = resolved;
    window.dispatchEvent(new CustomEvent("hub:theme-change", { detail: resolved }));
    confirm();
  };
  const changePalette = (value: "default" | "gold-ivory") => {
    setPalette(value);
    if (value === "gold-ivory") {
      store("hub.palette", value);
      document.documentElement.dataset.palette = value;
    } else {
      try { localStorage.setItem("hub.palette", "default"); } catch { /* 端末に書けなくても続ける */ }
      delete document.documentElement.dataset.palette;
    }
    confirm();
  };
  const changeAccent = (value: Accent) => {
    setAccent(value);
    store("hub.accent", value);
    document.documentElement.dataset.accent = value;
    confirm();
  };
  const changeTextSize = (value: TextSize) => {
    setTextSize(value);
    store("hub.text-size", value);
    document.documentElement.dataset.textSize = value;
    confirm();
  };
  const changeCompact = (value: boolean) => {
    setCompact(value);
    store("hub.compact", String(value));
    document.documentElement.dataset.compact = String(value);
    confirm();
  };
  const changeMotion = (value: boolean) => {
    setReduceMotion(value);
    store("hub.reduce-motion", String(value));
    document.documentElement.dataset.reduceMotion = String(value);
    confirm();
  };
  const changeRightOpen = (value: boolean) => {
    setRightOpen(value);
    store("hub.right-open", String(value));
    window.dispatchEvent(new CustomEvent("hub:right-open-change", { detail: value }));
    confirm();
  };
  const changeDensity = (value: FeedDensity) => {
    setDensity(value);
    store("hub.feed-density", value);
    document.documentElement.dataset.feedDensity = value;
    window.dispatchEvent(new CustomEvent("hub:feed-density-change", { detail: value }));
    confirm();
  };
  const reset = () => {
    clearStoredDisplayPreferences(localStorage);
    const resolved = systemPrefersDark() ? "dark" : "light";
    setTheme("auto"); setAccent("gold"); setPalette("default"); setTextSize("standard"); setCompact(false); setReduceMotion(false); setRightOpen(true); setDensity("standard");
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.accent = "gold";
    delete document.documentElement.dataset.palette;
    document.documentElement.dataset.textSize = "standard";
    document.documentElement.dataset.compact = "false";
    document.documentElement.dataset.reduceMotion = "false";
    document.documentElement.dataset.feedDensity = "standard";
    window.dispatchEvent(new CustomEvent("hub:theme-change", { detail: resolved }));
    window.dispatchEvent(new CustomEvent("hub:right-open-change", { detail: true }));
    window.dispatchEvent(new CustomEvent("hub:column-width-reset"));
    confirm();
  };

  const row = (label: string, control: ReactNode) => (
    <div className="v2-srow">
      <span className="v2-srow__label">{label}</span>
      {control}
    </div>
  );

  return (
    <div className="v2-settings__group">
      <p className="v2-settings__saved" role="status" aria-live="polite">{saved ? (ja ? "保存しました" : "Saved") : ""}</p>
      <div className="v2-sgroup">
        {row(ja ? "テーマ" : "Theme", (
          <Segmented<Theme>
            label={ja ? "テーマ" : "Theme"}
            value={theme}
            onChange={changeTheme}
            options={[
              { value: "auto", label: ja ? "端末" : "System" },
              { value: "light", label: ja ? "明るい" : "Light" },
              { value: "dark", label: ja ? "暗い" : "Dark" },
            ]}
          />
        ))}
        {row(ja ? "配色" : "Palette", (
          <Segmented<"default" | "gold-ivory">
            label={ja ? "配色" : "Palette"}
            value={palette}
            onChange={changePalette}
            options={[
              { value: "gold-ivory", label: ja ? "黒金" : "Black & gold" },
              { value: "default", label: ja ? "白黒" : "Black & white" },
            ]}
          />
        ))}
        {/* 強調色は当面隠す（2026-10-31）。黒金・白黒はどちらも強調色を固定するため。保存値はそのまま残す。 */}
        {SHOW_ACCENT_ROW && row(ja ? "強調色" : "Accent", (
          <button type="button" className="v2-srow__value" onClick={() => setAccentOpen(true)}>
            <span>{ja ? ACCENT_LABELS_JA[accent] : accent}</span>
            <V2Icon name="chevron-right" />
          </button>
        ))}
        {row(ja ? "文字の大きさ" : "Text size", (
          <Segmented<TextSize>
            label={ja ? "文字の大きさ" : "Text size"}
            value={textSize}
            onChange={changeTextSize}
            options={[
              { value: "standard", label: ja ? "標準" : "Standard" },
              { value: "large", label: ja ? "大きい" : "Large" },
            ]}
          />
        ))}
        {row(ja ? "フィードの密度" : "Feed density", (
          <Segmented<FeedDensity>
            label={ja ? "フィードの密度" : "Feed density"}
            value={density}
            onChange={changeDensity}
            options={[
              { value: "standard", label: ja ? "標準" : "Standard" },
              { value: "compact", label: ja ? "詰める" : "Compact" },
              { value: "media", label: ja ? "画像大" : "Media" },
            ]}
          />
        ))}
      </div>
      <div className="v2-sgroup">
        <Switch label={ja ? "余白を詰める" : "Compact spacing"} checked={compact} onChange={changeCompact} />
        <Switch label={ja ? "動きを減らす" : "Reduce motion"} checked={reduceMotion} onChange={changeMotion} />
        <Switch label={ja ? "右列を開いておく" : "Keep the right column open"} checked={rightOpen} onChange={changeRightOpen} />
        <button type="button" className="v2-srow" onClick={() => setResetOpen(true)}>
          {ja ? "表示設定を初期値に戻す" : "Reset display settings"}
        </button>
      </div>
      <p className="v2-settings__note">{ja ? "この端末にだけ保存されます。" : "Saved on this device only."}</p>

      <Sheet open={accentOpen} onClose={() => setAccentOpen(false)} title={ja ? "強調色" : "Accent"}>
        <div className="v2-sheet-list" role="radiogroup" aria-label={ja ? "強調色" : "Accent"}>
          {ACCENTS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={accent === value}
              className="v2-sheet-list__item"
              onClick={() => { changeAccent(value); setAccentOpen(false); }}
            >
              <span>{ja ? ACCENT_LABELS_JA[value] : value}</span>
              {accent === value ? <V2Icon name="check" /> : null}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={resetOpen} onClose={() => setResetOpen(false)} title={ja ? "表示設定を初期値に戻しますか" : "Reset display settings?"}>
        <p className="v2-settings__note">{ja ? "テーマ・強調色・文字の大きさ・密度・列の幅がこの端末で初期値に戻ります。" : "Theme, accent, text size, density and column widths return to their defaults on this device."}</p>
        <div className="v2-sheet-actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={() => setResetOpen(false)}>{ja ? "やめる" : "Cancel"}</button>
          <button type="button" className="ui-button ui-button--primary" onClick={() => { reset(); setResetOpen(false); }}>{ja ? "戻す" : "Reset"}</button>
        </div>
      </Sheet>
    </div>
  );
}
