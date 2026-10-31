"use client";

import Link from "next/link";
import React, { FormEvent, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import {
  parseSavedSurfaceQueries,
  removeSurfaceQuery,
  saveSurfaceQuery,
  SAVED_SURFACE_QUERY_STORAGE_KEY,
  serializeSavedSurfaceQueries,
  type QuerySurface,
  type SavedSurfaceQuery,
} from "@/lib/saved-surface-queries";

type Props = {
  surface: QuerySurface;
  currentValue: string;
  onApply?: (value: string) => void;
  labels?: { save?: string; placeholder?: string; aria?: string };
};

export function SavedQueryTabs({ surface, currentValue, onApply, labels }: Props) {
  const [items, setItems] = useState<SavedSurfaceQuery[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    let next = parseSavedSurfaceQueries(window.localStorage.getItem(SAVED_SURFACE_QUERY_STORAGE_KEY));
    if (surface === "search") {
      try {
        const legacy = JSON.parse(window.localStorage.getItem("hub.search.saved") ?? "[]") as unknown;
        if (Array.isArray(legacy)) {
          legacy.filter((item): item is string => typeof item === "string").forEach((value) => {
            next = saveSurfaceQuery(next, { surface: "search", label: value, value });
          });
          if (legacy.length) {
            window.localStorage.setItem(SAVED_SURFACE_QUERY_STORAGE_KEY, serializeSavedSurfaceQueries(next));
            window.localStorage.removeItem("hub.search.saved");
          }
        }
      } catch {
        // Legacy search storage is optional and never blocks the current UI.
      }
    }
    setItems(next);
  }, [surface]);

  const persist = (next: SavedSurfaceQuery[]) => {
    setItems(next);
    window.localStorage.setItem(SAVED_SURFACE_QUERY_STORAGE_KEY, serializeSavedSurfaceQueries(next));
  };
  const surfaceItems = items.filter((item) => item.surface === surface);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = saveSurfaceQuery(items, { surface, label: name, value: currentValue });
    if (next === items) return;
    persist(next);
    setName("");
  };

  return <section className="saved-query-tabs" aria-label={labels?.aria ?? "保存した表示"}>
    {surfaceItems.length ? <nav>
      {surfaceItems.map((item) => <span key={item.id}>
        {onApply
          ? <button type="button" onClick={() => onApply(item.value)}>{item.label}</button>
          : <Link href={item.value}>{item.label}</Link>}
        <button
          type="button"
          className="saved-query-tabs__remove"
          aria-label={`${item.label}を削除`}
          title="保存した表示を削除"
          onClick={() => persist(removeSurfaceQuery(items, item.id))}
        ><X aria-hidden="true" /></button>
      </span>)}
    </nav> : null}
    <details>
      <summary><Plus aria-hidden="true" />{labels?.save ?? "現在の表示を保存"}</summary>
      <form onSubmit={submit}>
        <input
          value={name}
          maxLength={32}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder={labels?.placeholder ?? "タブ名"}
          aria-label={labels?.placeholder ?? "タブ名"}
        />
        <button type="submit" disabled={!name.trim() || !currentValue.trim()}>保存</button>
      </form>
    </details>
  </section>;
}
