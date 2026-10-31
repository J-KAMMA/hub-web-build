"use client";

import { SettingToggle } from "@/components/ui/setting-toggle";
import { useTranslationPreference } from "@/components/translation-preference-provider";
import type { HubLocale } from "@/lib/i18n";
import {
  isTranslationSourceDisplayLanguage,
  TRANSLATION_SOURCE_LANGUAGES,
  translationLanguageEnabledByDefault,
  type TranslationSourceLanguage,
} from "@/lib/translation-preference";
import { hubUi } from "@/lib/ui-copy";

/*
 * 翻訳する言語の切り替え（2026-09-05、旦那様の「全部を v2 に」）。
 *
 * もとは settings-panel.tsx の表示設定の中に直書きだった。v2 の設定にも
 * 同じ節が要るので切り出す。状態は TranslationPreferenceProvider が持って
 * いるので、ここは操作だけ。
 *
 * **表示言語は切り替えられない。** その言語で書かれたものを訳す意味が無く、
 * 消すと「なぜ出ないのか」が分からなくなるので、出したまま操作を止める。
 */
export function TranslationLanguageSettings({ locale, onSaved }: {
  locale: HubLocale;
  onSaved?: () => void;
}) {
  const copy = hubUi(locale).settings;
  const { preferences, saving, updateLanguage } = useTranslationPreference();

  const labels: Record<TranslationSourceLanguage, string> = {
    ja: copy.translationJapanese,
    en: copy.translationEnglish,
    ko: copy.translationKorean,
    "zh-CN": copy.translationChinese,
    other: copy.translationOther,
  };

  return (
    <>
      <div className="settings-note" id="translation-settings">
        <strong>{copy.translationDisplay}</strong>
        <p>{copy.translationDisplayHelp}</p>
      </div>
      {TRANSLATION_SOURCE_LANGUAGES.map((language) => {
        const isDisplayLanguage = isTranslationSourceDisplayLanguage(language, locale);
        return (
          <SettingToggle
            key={language}
            label={labels[language]}
            description={isDisplayLanguage ? copy.translationDisplayLanguageHelp : copy.translationLanguageHelp}
            value={isDisplayLanguage ? false : preferences[language] ?? translationLanguageEnabledByDefault(language, locale)}
            disabled={saving || isDisplayLanguage}
            onChange={(enabled) => void (async () => {
              if (await updateLanguage(language, enabled)) onSaved?.();
            })()}
          />
        );
      })}
    </>
  );
}
