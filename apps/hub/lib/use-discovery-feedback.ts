"use client";

import { useEffect, useState } from "react";
import { DISCOVERY_FEEDBACK_EVENT, readDiscoveryHidden, setDiscoveryHidden } from "./discovery-feedback";

export function useDiscoveryFeedback(surface: string) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [readError, setReadError] = useState(false);
  useEffect(() => {
    const refresh = () => { try { setHidden(readDiscoveryHidden(window.localStorage,true)); setReadError(false); } catch { setReadError(true); } };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(DISCOVERY_FEEDBACK_EVENT, refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(DISCOVERY_FEEDBACK_EVENT, refresh); };
  }, []);
  const change = (id: string, value: boolean) => {
    try {
      setHidden(setDiscoveryHidden(`${surface}:${id}`, value, window.localStorage));
      setLast(value ? id : null);
      setError(false);
      window.dispatchEvent(new Event(DISCOVERY_FEEDBACK_EVENT));
      return true;
    } catch { setError(true); return false; }
  };
  return { isHidden: (id: string) => hidden.includes(`${surface}:${id}`), dismiss: (id: string) => change(id, true),
    isAuthorReduced: (id: string) => hidden.includes(`${surface}:author:${id}`),
    reduceAuthor: (id: string) => hidden.includes(`${surface}:author:${id}`) ? false : change(`author:${id}`, true),
    restoreAuthor: (id: string) => change(`author:${id}`, false),
    undo: () => last ? change(last, false) : false, last, error, readError,
    retryRead: () => window.dispatchEvent(new Event(DISCOVERY_FEEDBACK_EVENT)) };
}
