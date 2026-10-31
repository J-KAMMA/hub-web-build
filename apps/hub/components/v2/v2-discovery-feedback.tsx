"use client";

import { useEffect, useRef, useState } from "react";
import { discoveryMatchingInterest } from "@/lib/discovery-recommendations";
import type { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";

export function V2DiscoveryOptions({ text, interests, japanese, dismiss, fallbackReason, reduceAuthor, restoreAuthor }: {
  text: string; interests: readonly string[]; japanese: boolean; dismiss: () => void; fallbackReason?: string; reduceAuthor?: () => void; restoreAuthor?: () => void;
}) {
  const match = discoveryMatchingInterest(text, interests);
  return <details className="v2-discovery">
    <summary>{japanese ? "おすすめの調整" : "Recommendation options"}</summary>
    <div className="v2-discovery__panel">
      <p>{match
        ? (japanese ? `関心のある「${match}」に関連しています。` : `Related to your interest in ${match}.`)
        : (fallbackReason ?? (japanese ? "カタログから紹介しています。" : "Selected from the catalog."))}</p>
      <button type="button" onClick={dismiss}>{japanese ? "興味なし" : "Not interested"}</button>
      {restoreAuthor ? <button type="button" onClick={restoreAuthor}>{japanese ? "この作者の順位を元に戻す" : "Restore this author's priority"}</button>
        : reduceAuthor ? <button type="button" onClick={reduceAuthor}>{japanese ? "この作者を減らす" : "Show less from this author"}</button> : null}
    </div>
  </details>;
}

export function V2DiscoveryFeedbackStatus({ feedback, japanese }: {
  feedback: ReturnType<typeof useDiscoveryFeedback>; japanese: boolean;
}) {
  const undoButton = useRef<HTMLButtonElement>(null);
  const restoredStatus = useRef<HTMLParagraphElement>(null);
  const [restored, setRestored] = useState(false);
  const [restoredAuthor, setRestoredAuthor] = useState(false);
  useEffect(() => {
    if (feedback.last) {
      setRestored(false);
      // Removing the focused card sends focus to body. Do not override a
      // different control the user has focused in the meantime.
      if (document.activeElement === document.body) undoButton.current?.focus();
    }
  }, [feedback.last]);
  useEffect(() => {
    if (restored && document.activeElement === document.body) restoredStatus.current?.focus();
  }, [restored]);
  return <>
    {feedback.readError ? <p role="status">{japanese ? "おすすめ設定を読み込めませんでした。" : "Could not load recommendation preferences."} <button type="button" onClick={feedback.retryRead}>{japanese ? "設定を再読み込み" : "Retry loading preferences"}</button></p> : null}
    {feedback.last ? <p role="status">{feedback.last.startsWith("author:") ? (japanese ? "この作者のおすすめ順位を下げました。" : "Lowered this author's recommendation priority.") : (japanese ? "おすすめから非表示にしました。" : "Hidden from recommendations.")} <button ref={undoButton} type="button" onClick={() => { const author = feedback.last?.startsWith("author:") ?? false; if (feedback.undo()) { setRestoredAuthor(author); setRestored(true); } }}>{japanese ? "元に戻す" : "Undo"}</button></p> : null}
    {restored && !feedback.last ? <p ref={restoredStatus} role="status" tabIndex={-1}>{restoredAuthor ? (japanese ? "作者のおすすめ順位を元に戻しました。" : "Restored the author's recommendation priority.") : (japanese ? "非表示を取り消しました。" : "Restored to recommendations.")}</p> : null}
    {feedback.error ? <p role="alert">{japanese ? "保存できませんでした。もう一度お試しください。" : "Could not save. Please try again."}</p> : null}
  </>;
}
