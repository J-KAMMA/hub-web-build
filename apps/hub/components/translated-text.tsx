"use client";

import { settingsSectionHref } from "@/lib/settings-section-href";

import Link from "next/link";
import React, { useState } from "react";

import { hubMessages, type HubLocale } from "@/lib/i18n";
import { useTranslationPreference } from "@/components/translation-preference-provider";
import { translateWithPersonalNode } from "@/lib/personal-node-translation-client";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import {
  isTranslationSourceDisplayLanguage,
  translationLanguageEnabledByDefault,
  type TranslationSourceLanguage,
} from "@/lib/translation-preference";

type PublicTranslationTarget = "social_post" | "thread_post" | "community_message";

interface TranslatedTextProps {
  className?: string;
  locale: HubLocale;
  targetId: string;
  targetType: PublicTranslationTarget;
  text: string;
  sourceLocale?: string;
  collapsible?: boolean;
}

const BODY_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const BODY_LINK_PATTERN = /https?:\/\/[^\s<>"'`]+|@[a-z0-9_]{1,32}|#[\p{L}\p{N}_-]{1,64}/giu;
const BODY_URL_TRAILING_PUNCTUATION = /[.,!?;:)\]}＞、。！）：；？]+$/u;

function normalizedLanguage(value?: string): TranslationSourceLanguage | null {
  if (!value) return null;
  const language = value.trim().toLowerCase().replace("_", "-");
  if (language === "zh" || language.startsWith("zh-")) return "zh-CN";
  if (language.startsWith("ja")) return "ja";
  if (language.startsWith("ko")) return "ko";
  if (language.startsWith("en")) return "en";
  return "other";
}

export function detectTranslationSourceLanguage(
  text: string,
  sourceLocale?: string,
  displayLocale?: HubLocale,
): TranslationSourceLanguage | null {
  const declaredSource = normalizedLanguage(sourceLocale);
  if (declaredSource) return declaredSource;

  const sample = text
    .replace(BODY_URL_PATTERN, " ")
    .replace(/[@#][\p{L}\p{N}_-]+/gu, " ")
    .trim();
  if (!/[\p{L}\p{Script=Han}]/u.test(sample)) return null;

  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(sample)) return "ja";
  if (/\p{Script=Hangul}/u.test(sample)) return "ko";
  if (/\p{Script=Han}/u.test(sample)) return normalizedLanguage(displayLocale) === "zh-CN" ? "zh-CN" : "ja";

  const latinWords = sample.match(/\p{Script=Latin}+/gu) ?? [];
  if (latinWords.length) {
    return latinWords.length >= 2 || latinWords.join("").length >= 12 ? "en" : null;
  }

  return "other";
}

export function shouldOfferTranslation(text: string, locale: HubLocale, sourceLocale?: string): boolean {
  const sourceLanguage = detectTranslationSourceLanguage(text, sourceLocale, locale);
  return sourceLanguage ? translationLanguageEnabledByDefault(sourceLanguage, locale) : false;
}

export function LinkifiedText({ className, text }: { className?: string; text: string }) {
  /* 見ている面の中に留まる。本文の @handle も同じ面のプロフィールへ。 */
  const surface = useHubUiSurface();
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(BODY_LINK_PATTERN)) {
    const index = match.index ?? 0;
    const matched = match[0];
    if (matched.startsWith("#")) {
      const previous = index > 0 ? text[index - 1] : "";
      if (previous && /[\p{L}\p{N}_-]/u.test(previous)) continue;
      if (index > cursor) parts.push(text.slice(cursor, index));
      parts.push(
        <Link
          className="translated-text__hashtag"
          href={hubSurfacePath(surface, `/search?q=${encodeURIComponent(matched)}`)}
          key={`${index}-${matched}`}
        >
          {matched}
        </Link>
      );
      cursor = index + matched.length;
      continue;
    }
    if (matched.startsWith("@")) {
      const previous = index > 0 ? text[index - 1] : "";
      if (previous && /[\p{L}\p{N}._%+-]/u.test(previous)) continue;
      if (index > cursor) parts.push(text.slice(cursor, index));
      const handle = matched.slice(1);
      parts.push(
        <Link
          className="translated-text__mention"
          href={hubSurfacePath(surface, `/profile/${encodeURIComponent(handle)}`)}
          key={`${index}-${matched}`}
        >
          {matched}
        </Link>
      );
      cursor = index + matched.length;
      continue;
    }
    const url = matched.replace(BODY_URL_TRAILING_PUNCTUATION, "");
    if (!url || url.length > 2048) continue;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }

    if (index > cursor) parts.push(text.slice(cursor, index));
    const isJkamma = parsed.hostname === "jkamma.com" || parsed.hostname.endsWith(".jkamma.com");
    parts.push(
      <a
        className="translated-text__link"
        href={parsed.toString()}
        key={`${index}-${url}`}
        target={isJkamma ? undefined : "_blank"}
        rel={isJkamma ? undefined : "noopener noreferrer nofollow ugc"}
      >
        {url}
      </a>
    );
    if (matched.length > url.length) parts.push(matched.slice(url.length));
    cursor = index + matched.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <p className={className}>{parts.length ? parts : text}</p>;
}

function CollapsibleText({ className, text, enabled }: { className?: string; text: string; enabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = Boolean(enabled && (text.length > 600 || text.split("\n").length > 12));
  return <div className={long ? "translated-text__collapse" : undefined} data-expanded={expanded || undefined}><LinkifiedText className={className} text={text} />{long && <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "折りたたむ" : "全文を読む"}</button>}</div>;
}

export function TranslatedText({ className, locale, targetId, targetType, text, sourceLocale, collapsible }: TranslatedTextProps) {
  const copy = hubMessages(locale).translate;
  /* 読み手が居る面。v2 から描かれたら翻訳の設定も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const { preferences } = useTranslationPreference();
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const toggle = async () => {
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }
    if (translation) {
      setShowTranslation(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const localTranslation = await translateWithPersonalNode({
        targetType,
        targetId,
        sourceLocale: sourceLanguage ?? sourceLocale ?? "unknown",
        targetLocale: locale,
        text,
      });
      if (localTranslation) {
        setTranslation(localTranslation);
        setShowTranslation(true);
        return;
      }
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, targetLocale: locale })
      });
      const payload = await response.json() as { translation?: string };
      if (!response.ok || !payload.translation) throw new Error("Translation failed");
      setTranslation(payload.translation);
      setShowTranslation(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const sourceLanguage = detectTranslationSourceLanguage(text, sourceLocale, locale);
  const offerTranslation = sourceLanguage && !isTranslationSourceDisplayLanguage(sourceLanguage, locale)
    ? preferences[sourceLanguage] ?? shouldOfferTranslation(text, locale, sourceLocale)
    : false;
  if (!sourceLanguage || !offerTranslation) {
    return <CollapsibleText className={className} text={text} enabled={collapsible} />;
  }

  const displayedText = showTranslation && translation ? translation : text;

  return (
    <div className="translated-text">
      <CollapsibleText className={className} text={displayedText} enabled={collapsible} />
      <div className="translated-text__controls">
        <span className="translated-text__source">{copy.from[sourceLanguage]}</span>
        <Link className="translated-text__settings" href={settingsSectionHref(surface, "translation-settings")}>{copy.settings}</Link>
        <span className="translated-text__separator" aria-hidden="true">·</span>
        <button type="button" className="translated-text__toggle" onClick={toggle} disabled={loading}>
          {loading ? copy.loading : showTranslation ? copy.original : copy.action}
        </button>
      </div>
      {error ? <span className="translated-text__error" role="status">{copy.error}</span> : null}
    </div>
  );
}
