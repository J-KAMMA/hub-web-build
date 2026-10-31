"use client";

import { useCallback, useEffect, useState } from "react";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT, hubPersonalizationEnabled, readHubInterestProfile, recordHubInterests, topHubInterests, type HubInterestSource } from "@/lib/hub-interest-profile";

export function useHubRecommendations() {
  const [state, setState] = useState<{ interests: string[]; enabled: boolean }>({ interests: [], enabled: false });
  useEffect(() => {
    const refresh = () => {
      try {
        const enabled = hubPersonalizationEnabled();
        setState({ enabled, interests: enabled ? topHubInterests(readHubInterestProfile()) : [] });
      } catch { setState({ interests: [], enabled: false }); }
    };
    refresh();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const record = useCallback((source: HubInterestSource, values: readonly string[], weight = 1) => {
    try { recordHubInterests(source, values, weight); } catch { /* Optional storage must never block navigation. */ }
  }, []);
  return { ...state, record };
}
