"use client";

import React, { useMemo, useState } from "react";
import { AiWorkbench } from "@/components/ai-workbench";
import { V2AiWorkspaceHost, useV2AiWorkspace } from "@/components/v2/v2-ai-workspace";
import { useHubUiSurface } from "@/lib/hub-surface-context";
import {
  createAiContextPrompt,
  getAiContextActions,
  type HubAiContext,
  type HubAiIntent,
} from "@/lib/ai-context";

export function AiRightRail({ context, showHeading = true, isActive, scope = "" }: { context?: HubAiContext | null; showHeading?: boolean; isActive?: () => boolean; scope?: string }) {
  const workspace = useV2AiWorkspace();
  const surface = useHubUiSurface();
  const contextPrompt = useMemo(
    () => context ? createAiContextPrompt(context) : "",
    [context],
  );
  const [selection, setSelection] = useState({ source: contextPrompt, prompt: contextPrompt });
  const prompt = selection.source === contextPrompt ? selection.prompt : contextPrompt;
  const delivery = useMemo(() => prompt ? { key: {}, prompt, context: context ?? null } : undefined, [prompt, context]);
  const actions = useMemo(
    () => context ? getAiContextActions(context.source) : [],
    [context],
  );

  const selectIntent = (intent: HubAiIntent) => {
    if (context) setSelection({ source: contextPrompt, prompt: createAiContextPrompt({ ...context, intent }) });
  };

  return (
    <section className="ai-right-rail" aria-label="AI">
      {showHeading ? <header className="ai-right-rail__header"><div><h2>AI</h2></div></header> : null}
      {context ? (
        <div className="ai-right-rail__context-actions" aria-label="選択した内容に対するAI操作">
          {actions.map((action) => (
            <button type="button" key={action.intent} onClick={() => selectIntent(action.intent)}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {workspace && surface === "/v2" ? <V2AiWorkspaceHost kind="rail" scope={scope} context={context} delivery={delivery} isActive={isActive} /> : <AiWorkbench
        variant="rail"
        initialPrompt={prompt || undefined}
        initialContext={context}
        isActive={isActive}
      />}
    </section>
  );
}
