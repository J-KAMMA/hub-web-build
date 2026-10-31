"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MUSIC_FAVORITES_CHANGED_EVENT } from "./music-player-events";

const KEY = "music.favorites";
function readDeviceFavorites(fallback:string[]):string[]{
 const raw=localStorage.getItem(KEY);
 if(raw===null)return fallback;
 const value:unknown=JSON.parse(raw);
 if(!Array.isArray(value)||value.some(id=>typeof id!=="string"))throw new Error("Invalid favourites");
 return [...new Set(value)] as string[];
}

export function useMusicFavorites(initialIds: string[], authenticated: boolean) {
  const [favorites, setFavorites] = useState(initialIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"save" | "cache" | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (authenticated) return;
    const sync=()=>{try{setFavorites(readDeviceFavorites([]));}catch{ /* Keep the last known state on read failure. */ }};
    sync();
    window.addEventListener(MUSIC_FAVORITES_CHANGED_EVENT,sync);
    const storage=(event:StorageEvent)=>{if(event.key===KEY||event.key===null)sync();};
    window.addEventListener("storage",storage);
    return()=>{window.removeEventListener(MUSIC_FAVORITES_CHANGED_EVENT,sync);window.removeEventListener("storage",storage);};
  }, [authenticated]);

  const toggle = useCallback(async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const current=authenticated?favorites:readDeviceFavorites(favorites);
      const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
      if (authenticated) {
        const response = await fetch("/api/music/favorites", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ workIds: next }),
        });
        if (!response.ok) throw new Error("Could not save favourites");
      }
      try { localStorage.setItem(KEY, JSON.stringify(next)); }
      catch (storageError) {
        if (!authenticated) throw storageError;
        // The account write succeeded even if this device cannot cache it.
        setError("cache");
      }
      setFavorites(next);
      window.dispatchEvent(new CustomEvent<string[]>(MUSIC_FAVORITES_CHANGED_EVENT, { detail: next }));
    } catch { setError("save"); }
    finally { busy.current = false; setSaving(false); }
  }, [authenticated, favorites]);
  return { favorites, saving, error, toggle };
}
