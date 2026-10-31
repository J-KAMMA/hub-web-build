"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { TAG_MAX_LENGTH, TAG_MAX_PER_ITEM, normalizeTag, normalizeTagList, splitTagInput } from "@jkamma/content-tags";

import styles from "./v2-tag-input.module.css";

/*
 * The one tag entry field for every Hub form (2026-10-29): chips with remove buttons, typing splits on
 * whitespace , 、 ，  (the middle dot stays part of a tag), Enter/Tab accepts, Backspace removes the last chip.
 * Suggestions come from the Hub popular-tags API and, in music forms, from the Music Worker called by the browser.
 */

export type V2TagSuggestionSource = "hub" | "music";

const SEPARATOR = /[\s,、，]/u;
const HUB_TAGS_API = "/api/tags";
const MUSIC_TAGS_API = "/music/api/v1/tags/popular";

export interface V2TagInputProps {
  /** Display-form tags, already normalised. */
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
  /** Where remote suggestions come from. Default: Hub only. [] disables the network. */
  sources?: V2TagSuggestionSource[];
  /** Local suggestions shown in addition to the remote ones. */
  suggestions?: string[];
  /** When set, a hidden input with this name carries the tags joined by a space (for FormData forms). */
  name?: string;
  disabled?: boolean;
}

async function fetchSuggestions(source: V2TagSuggestionSource, prefix: string, signal: AbortSignal): Promise<string[]> {
  const url = source === "hub"
    ? `${HUB_TAGS_API}?limit=8${prefix ? `&q=${encodeURIComponent(prefix)}` : ""}`
    : `${MUSIC_TAGS_API}?limit=8${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ""}`;
  const response = await fetch(url, { signal, credentials: source === "music" ? "same-origin" : undefined });
  if (!response.ok) return [];
  const payload = await response.json() as { tags?: Array<{ name?: string }>; items?: Array<{ display?: string }> };
  const names = source === "hub"
    ? (payload.tags ?? []).map((item) => item.name)
    : (payload.items ?? []).map((item) => item.display);
  return names.filter((name): name is string => typeof name === "string");
}

function lengthError(raw: string): string | null {
  const candidate = raw.normalize("NFKC").trim().replace(/^#+/u, "");
  return Array.from(candidate).length > TAG_MAX_LENGTH ? `タグは1個${TAG_MAX_LENGTH}文字までです。` : null;
}

export function V2TagInput({
  value,
  onChange,
  label = "タグ",
  placeholder,
  sources = ["hub"],
  suggestions = [],
  name,
  disabled = false,
}: V2TagInputProps) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [entry, setEntry] = useState("");
  const [remote, setRemote] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const composing = useRef(false);
  const sourceKey = sources.join(",");

  const tags = useMemo(() => normalizeTagList(value).map((tag) => tag.display), [value]);
  const full = tags.length >= TAG_MAX_PER_ITEM;
  const liveError = lengthError(entry) ?? notice;

  useEffect(() => {
    if (!sourceKey || disabled) return;
    const prefix = normalizeTag(entry)?.key ?? "";
    if (entry.trim() && !prefix) { setRemote([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all(sourceKey.split(",").map((source) =>
        fetchSuggestions(source as V2TagSuggestionSource, prefix, controller.signal).catch(() => [] as string[])))
        .then((lists) => { if (!controller.signal.aborted) setRemote(lists.flat()); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [entry, sourceKey, disabled]);

  const options = useMemo(() => {
    const taken = new Set(tags.map((tag) => normalizeTag(tag)?.key));
    const query = normalizeTag(entry)?.key ?? "";
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [...remote, ...suggestions]) {
      const tag = normalizeTag(raw);
      if (!tag || taken.has(tag.key) || seen.has(tag.key)) continue;
      if (query && !tag.key.includes(query)) continue;
      seen.add(tag.key);
      out.push(tag.display);
    }
    return out.slice(0, 8);
  }, [remote, suggestions, tags, entry]);

  const showList = open && !full && options.length > 0;

  function commit(rawList: string[], current: string[]): { tags: string[]; rejected: string | null } {
    let next = current;
    let rejected: string | null = null;
    for (const raw of rawList) {
      const tag = normalizeTag(raw);
      if (!tag) {
        if (raw.normalize("NFKC").replace(/^#+/u, "").trim()) rejected = lengthError(raw) ?? "このタグは使えません。";
        continue;
      }
      if (next.some((existing) => normalizeTag(existing)?.key === tag.key)) continue;
      if (next.length >= TAG_MAX_PER_ITEM) { rejected = `タグは${TAG_MAX_PER_ITEM}個までです。`; break; }
      next = [...next, tag.display];
    }
    return { tags: next, rejected };
  }

  function accept(raw: string) {
    const result = commit([raw], tags);
    if (result.tags !== tags) onChange(result.tags);
    setNotice(result.rejected);
    // An invalid or over-limit entry stays in the box so the author can fix it.
    if (!result.rejected) setEntry("");
    setActive(-1);
    setOpen(false);
  }

  function handleText(text: string) {
    // Split while typing or pasting; the part after the last separator stays in the box.
    if (!SEPARATOR.test(text)) { setEntry(text); setNotice(null); setOpen(true); setActive(-1); return; }
    const parts = text.split(/[\s,、，]+/u);
    const rest = parts.pop() ?? "";
    const result = commit(splitTagInput(parts.join(" ")), tags);
    if (result.tags !== tags) onChange(result.tags);
    setNotice(result.rejected);
    setEntry(rest);
    setActive(-1);
    setOpen(true);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    if (composing.current) { setEntry(event.target.value); return; }
    handleText(event.target.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length || full) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => ((current + 1 + step + options.length + 1) % (options.length + 1)) - 1);
    } else if (event.key === "Escape") {
      if (showList) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
    } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && (entry.trim() || (showList && active >= 0)))) {
      if (event.key === "Enter") event.preventDefault();
      else if (entry.trim() || active >= 0) event.preventDefault();
      if (showList && active >= 0) accept(options[active]);
      else if (entry.trim()) accept(entry);
    } else if (event.key === "Backspace" && !entry && tags.length) {
      onChange(tags.slice(0, -1));
      setNotice(null);
    }
  }

  return (
    <div className={styles.field}>
      <span className={styles.head}>
        <label htmlFor={`${id}-input`}>{label}</label>
        <small aria-live="polite">{tags.length}/{TAG_MAX_PER_ITEM}</small>
      </span>
      <div className={styles.control}>
        <ul className={styles.chips} aria-label={`${label}の一覧`}>
          {tags.map((tag) => (
            <li className={styles.chip} key={normalizeTag(tag)?.key ?? tag}>
              #{tag}
              <button type="button" aria-label={`${tag}を削除`} disabled={disabled} onClick={() => { onChange(tags.filter((item) => item !== tag)); setNotice(null); }}>×</button>
            </li>
          ))}
        </ul>
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={liveError ? true : undefined}
          aria-describedby={liveError ? errorId : undefined}
          autoComplete="off"
          value={entry}
          placeholder={placeholder ?? (tags.length ? "タグを追加" : "例：TypeScript、Figma、リモート")}
          disabled={disabled || full}
          onChange={onInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(event) => { composing.current = false; handleText(event.currentTarget.value); }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1); if (entry.trim() && !lengthError(entry)) accept(entry); }}
        />
      </div>
      {liveError ? <p id={errorId} className={styles.error} role="alert">{liveError}</p> : null}
      <ul id={listId} role="listbox" aria-label={`${label}の候補`} className={styles.suggestions} hidden={!showList}>
        {showList ? options.map((tag, index) => (
          <li
            key={tag}
            id={`${id}-opt-${index}`}
            role="option"
            aria-selected={index === active}
            data-active={index === active ? "true" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => accept(tag)}
          >#{tag}</li>
        )) : null}
      </ul>
      {name ? <input type="hidden" name={name} value={tags.join(" ")} /> : null}
    </div>
  );
}
