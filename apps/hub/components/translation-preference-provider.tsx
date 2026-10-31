"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  isTranslationSourceLanguage,
  type TranslationLanguagePreferences,
  type TranslationSourceLanguage,
} from "@/lib/translation-preference";

type TranslationPreferenceContextValue = {
  preferences: TranslationLanguagePreferences;
  saving: boolean;
  updateLanguage: (language: TranslationSourceLanguage, enabled: boolean) => Promise<boolean>;
};

const TranslationPreferenceContext = createContext<TranslationPreferenceContextValue>({
  preferences: {},
  saving: false,
  updateLanguage: async () => false,
});

export function TranslationPreferenceProvider({
  children,
  initialPreferences = {},
  loadRemote = true,
}: {
  children: React.ReactNode;
  initialPreferences?: TranslationLanguagePreferences;
  loadRemote?: boolean;
}) {
  const [preferences, setPreferences] = useState<TranslationLanguagePreferences>(initialPreferences);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loadRemote) return;
    const controller = new AbortController();
    void fetch("/api/preferences/translation", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const languages = Reflect.get(payload, "languages");
        if (!languages || typeof languages !== "object") return;
        const next: TranslationLanguagePreferences = {};
        for (const [language, enabled] of Object.entries(languages)) {
          if (isTranslationSourceLanguage(language) && typeof enabled === "boolean") next[language] = enabled;
        }
        setPreferences(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [loadRemote]);

  const updateLanguage = useCallback(async (language: TranslationSourceLanguage, enabled: boolean) => {
    const previous = preferences;
    setPreferences((current) => ({ ...current, [language]: enabled }));
    setSaving(true);
    try {
      const response = await fetch("/api/preferences/translation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, enabled }),
      });
      if (!response.ok) throw new Error("Preference update failed");
      return true;
    } catch {
      setPreferences(previous);
      return false;
    } finally {
      setSaving(false);
    }
  }, [preferences]);

  const value = useMemo(() => ({ preferences, saving, updateLanguage }), [preferences, saving, updateLanguage]);
  return <TranslationPreferenceContext.Provider value={value}>{children}</TranslationPreferenceContext.Provider>;
}

export function useTranslationPreference() {
  return useContext(TranslationPreferenceContext);
}

export function TranslationPreferenceBridge({ value, children }: { value: TranslationPreferenceContextValue; children: React.ReactNode }) {
  return <TranslationPreferenceContext.Provider value={value}>{children}</TranslationPreferenceContext.Provider>;
}
