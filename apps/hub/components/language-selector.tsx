"use client";

import React from "react";

import { HUB_UI_LOCALES, HUB_LOCALE_COOKIE, type HubLocale } from "@/lib/i18n";

const names: Record<(typeof HUB_UI_LOCALES)[number], string> = { ja: "日本語", en: "English", ko: "한국어", "zh-CN": "简体中文", es: "Español", "pt-BR": "Português (Brasil)", fr: "Français", de: "Deutsch", id: "Bahasa Indonesia", hi: "हिन्दी", ar: "العربية", ru: "Русский", tr: "Türkçe", vi: "Tiếng Việt", th: "ไทย" };

export function LanguageSelector({ locale, label, description }: { locale: HubLocale; label: string; description?: string }) {
  return <label className="setting-select language-selector"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><select aria-label={label} value={locale} onChange={(event) => {
    const next = event.target.value as HubLocale;
    document.cookie = `${HUB_LOCALE_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    window.location.reload();
  }}>{HUB_UI_LOCALES.map((item) => <option key={item} value={item}>{names[item]}</option>)}</select></label>;
}
