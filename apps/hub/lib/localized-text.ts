import type { HubLocale } from "@/lib/i18n";

export type LocalizedText = { ja: string; en: string } & Partial<Record<HubLocale, string>>;

export function localizedText(locale: HubLocale, text: LocalizedText): string {
  return text[locale] ?? text.en;
}
