import type { D1Database } from "@cloudflare/workers-types";

import type { TranslationLanguagePreferences, TranslationSourceLanguage } from "@/lib/translation-preference";

type TranslationPreferenceRow = { source_language: TranslationSourceLanguage; enabled: number };

export async function listD1TranslationPreferences(
  database: D1Database,
  profileId: string,
): Promise<TranslationLanguagePreferences> {
  const result = await database.prepare(
    "SELECT source_language, enabled FROM profile_translation_language_preferences WHERE profile_id = ?",
  ).bind(profileId).all<TranslationPreferenceRow>();
  return Object.fromEntries(result.results.map((row) => [row.source_language, row.enabled === 1]));
}

export async function setD1TranslationPreference(
  database: D1Database,
  profileId: string,
  language: TranslationSourceLanguage,
  enabled: boolean,
): Promise<boolean> {
  await database.prepare(`
    INSERT INTO profile_translation_language_preferences (profile_id, source_language, enabled, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id, source_language) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(profileId, language, enabled ? 1 : 0, new Date().toISOString()).run();
  return enabled;
}
