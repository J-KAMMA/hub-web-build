"use client";
import { useState } from "react";
export function ThreadReadingTools({ threadId }: { threadId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(`${location.origin}/threads/${threadId}?view=spotlight`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  return <div className="thread-reading-tools" aria-label="閲覧と共有"><a href={`/threads/${threadId}`}>すべて</a><a href={`/threads/${threadId}?view=spotlight`}>読み方ガイド</a><button type="button" onClick={copy}>{copied ? "コピーしました" : "ガイドを共有"}</button></div>;
}
