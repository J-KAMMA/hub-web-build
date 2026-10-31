"use client";

import { useEffect, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";

import { activeSocialMention, replaceActiveSocialMention, type ActiveSocialMention } from "@/lib/social-mention-composer";

/*
 * メンション補完。既存の timeline-client.tsx の useMentionComposer から機能だけを抜いた。
 * @ に続く語で GET /api/social/mention-suggestions?q= を150ms遅らせて引き、
 * 上下で選び Enter / Tab で確定、Esc で閉じる。判定と置換は既存と同じ
 * lib/social-mention-composer.ts を呼ぶ（別実装にしない）。
 */

export type MentionSuggestion = { id: string; handle: string; displayName: string };

export function useV2Mentions(
  value: string,
  setValue: (next: string) => void,
  input: RefObject<HTMLTextAreaElement | null>,
) {
  const [active, setActive] = useState<ActiveSocialMention | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!active?.query) {
      setSuggestions([]);
      setSelected(0);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/social/mention-suggestions?q=${encodeURIComponent(active.query)}`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { suggestions?: MentionSuggestion[] };
        setSuggestions((payload.suggestions ?? []).slice(0, 5));
        setSelected(0);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setSuggestions([]);
      }
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active?.query]);

  const choose = (suggestion: MentionSuggestion) => {
    if (!active) return;
    const replacement = replaceActiveSocialMention(value, active, suggestion.handle);
    setValue(replacement.text);
    setActive(null);
    setSuggestions([]);
    window.requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(replacement.caret, replacement.caret);
    });
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    setActive(activeSocialMention(event.target.value, event.target.selectionStart));
  };

  /* 候補が出ているときだけ矢印・Enter・Tab・Esc を横取りする。true を返したら呼び手は何もしない。 */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!suggestions.length) return false;
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((index) => (index + 1) % suggestions.length); return true; }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((index) => (index - 1 + suggestions.length) % suggestions.length); return true; }
    if ((event.key === "Enter" && !event.ctrlKey && !event.metaKey) || event.key === "Tab") {
      event.preventDefault();
      const suggestion = suggestions[selected];
      if (suggestion) choose(suggestion);
      return true;
    }
    if (event.key === "Escape") { event.preventDefault(); setActive(null); setSuggestions([]); return true; }
    return false;
  };

  return { suggestions, selected, choose, onChange, onKeyDown };
}

export function V2MentionList({
  id,
  suggestions,
  selected,
  onChoose,
  japanese,
}: {
  id: string;
  suggestions: MentionSuggestion[];
  selected: number;
  onChoose: (suggestion: MentionSuggestion) => void;
  japanese: boolean;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="v2-mentions" id={id} role="listbox" aria-label={japanese ? "ユーザーをメンション" : "Mention a user"}>
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.id}
          type="button"
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === selected}
          className={index === selected ? "v2-mentions__item v2-mentions__item--selected" : "v2-mentions__item"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(suggestion)}
        >
          <strong>{suggestion.displayName}</strong>
          <small>@{suggestion.handle}</small>
        </button>
      ))}
    </div>
  );
}
