"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  createHubAiContextEnvelope,
  HUB_AI_CONTEXT_EVENT,
  HUB_AI_CONTEXT_STORAGE_KEY,
  type HubAiContext,
} from "@/lib/ai-context";

export function AiContextButton({ context, className, label, accessibleLabel = "AIで開く", stayOnPage = false, controls }: {
  context: HubAiContext;
  className?: string;
  label?: string;
  accessibleLabel?: string;
  stayOnPage?: boolean;
  controls?: string;
}) {
  const router = useRouter();
  const openAi = () => {
    if (!stayOnPage && document.documentElement.dataset.hubSurface === "app") {
      window.sessionStorage.setItem(
        HUB_AI_CONTEXT_STORAGE_KEY,
        JSON.stringify(createHubAiContextEnvelope(context)),
      );
      router.push("/ai?context=post");
      return;
    }
    window.dispatchEvent(new CustomEvent(HUB_AI_CONTEXT_EVENT, { detail: context }));
  };

  return (
    <button
      type="button"
      className={className}
      title={accessibleLabel}
      aria-label={accessibleLabel}
      aria-controls={controls}
      onClick={openAi}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2 14 9l5.8 2-5.8 2-2 5.8-2-5.8-5.8-2L10 9l2-5.8Z" />
        <path d="m18.5 3 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z" />
      </svg>
      {label ? <span>{label}</span> : null}
    </button>
  );
}
