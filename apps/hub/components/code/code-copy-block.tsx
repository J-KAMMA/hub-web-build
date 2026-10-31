"use client";

import { useState } from "react";

/** A read-only command or URL with a copy button. Falls back to selecting the text when the clipboard is blocked. */
export function CodeCopyBlock({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }
  return (
    <div className="hub-code__copy">
      <p className="hub-code__copy-label">{label}</p>
      <div className="hub-code__copy-row">
        {multiline ? <pre className="hub-code__mono" tabIndex={0}>{value}</pre> : <code className="hub-code__mono" tabIndex={0}>{value}</code>}
        <button type="button" className="hub-code__button" onClick={() => void copy()} aria-label={`${label}をコピー`}>
          {state === "copied" ? "コピーしました" : state === "failed" ? "選択してコピーしてください" : "コピー"}
        </button>
      </div>
    </div>
  );
}
