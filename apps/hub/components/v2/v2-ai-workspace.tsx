"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HubSurfaceProvider, useHubUiSurface } from "@/lib/hub-surface-context";
import { TranslationPreferenceBridge, useTranslationPreference } from "@/components/translation-preference-provider";
import { HUB_AI_CONTEXT_STORAGE_KEY, type HubAiContext } from "@/lib/ai-context";
import type { AiWorkbenchHandoff } from "@/components/ai-workbench";
const AiWorkbench = lazy(() => import("@/components/ai-workbench").then(module => ({ default: module.AiWorkbench })));

type Delivery = { key: object | string; prompt: string; context: HubAiContext | null };
type HostProps = {
  kind: "main" | "rail";
  scope: string;
  isActive?: () => boolean;
  context?: HubAiContext | null;
  delivery?: Delivery;
};
type Registration = HostProps & { surface: ReturnType<typeof useHubUiSurface>; translation: ReturnType<typeof useTranslationPreference> };
type Entry = { token: symbol; host: HTMLElement; props: Registration; epoch: number };
const Workspace = createContext<{
  ready: boolean;
  mount: (host: HTMLElement, props: Registration) => () => void;
  update: (host: HTMLElement, props: Registration) => void;
} | null>(null);
export const useV2AiWorkspace = () => useContext(Workspace);

/** The AI tree stays mounted; only its container changes parent. */
export function V2AiWorkspaceProvider({ children }: { children: ReactNode }) {
  const parking = useRef<HTMLDivElement>(null), container = useRef<HTMLDivElement | null>(null);
  const hosts = useRef(new Map<symbol, Entry>()), owner = useRef<Entry | null>(null), epoch = useRef(0);
  const currentScope = useRef<string | null>(null);
  const consumed = useRef(new WeakSet<object>()), consumedPrompts = useRef(new Set<string>());
  const reference = useRef<{ scope: string; context: HubAiContext | null }>({ scope: "", context: null });
  const [ready, setReady] = useState(false), [presentation, setPresentation] = useState<Registration | null>(null);
  const [hubEpoch, setHubEpoch] = useState(0);
  const [activation, setActivation] = useState<{ token: symbol; scope: string; epoch: number; accepting: boolean; isCurrent: () => boolean }>();
  const [context, setContext] = useState<HubAiContext | null>(null), [handoff, setHandoff] = useState<AiWorkbenchHandoff>();
  const active = useCallback(() => {
    const entry = owner.current;
    return Boolean(entry && entry.epoch === epoch.current && entry.host.isConnected && container.current?.parentElement === entry.host && !entry.host.closest("[hidden],[inert]") && entry.props.isActive?.() !== false);
  }, []);
  const publish = useCallback((fresh?: Entry) => {
    if (!container.current) return;
    const available = [...hosts.current.values()].filter(entry => entry.host.isConnected).reverse();
    const candidate = available.find(entry => entry.props.kind === "main") ?? available[0] ?? null;
    const next = candidate && (currentScope.current === null || candidate.props.scope === currentScope.current || candidate === fresh) ? candidate : null;
    owner.current = next;
    if (!next) { if (container.current) parking.current?.append(container.current); setActivation(undefined); return; }
    currentScope.current = next.props.scope;
    if (container.current) next.host.append(container.current);
    setPresentation(next.props);
    const accepting = active();
    const selectedEpoch = epoch.current, selectedScope = next.props.scope;
    setActivation(previous => previous?.token === next.token && previous.scope === selectedScope && previous.epoch === selectedEpoch && previous.accepting === accepting ? previous : { token: next.token, scope: selectedScope, epoch: selectedEpoch, accepting, isCurrent: () => epoch.current === selectedEpoch && owner.current?.token === next.token && owner.current?.props.scope === selectedScope && active() });
    if (reference.current.scope !== next.props.scope || next.props.context === null) {
      reference.current = { scope: next.props.scope, context: null }; setContext(null);
    }
    const delivery = next.props.delivery;
    if (!delivery || !active()) return;
    const key = delivery.key;
    if (typeof key === "string" ? consumedPrompts.current.has(key) : consumed.current.has(key)) return;
    if (typeof key === "string") consumedPrompts.current.add(key); else consumed.current.add(key);
    const acceptedEpoch = epoch.current, acceptedScope = next.props.scope, token = next.token;
    const isCurrent = () => epoch.current === acceptedEpoch && owner.current?.token === token && owner.current?.props.scope === acceptedScope && active();
    setHandoff({ prompt: delivery.prompt, context: delivery.context, isCurrent, onAccepted: () => {
      if (isCurrent()) { reference.current = { scope: acceptedScope, context: delivery.context }; setContext(delivery.context); }
    } });
  }, [active]);
  useLayoutEffect(() => {
    const node = document.createElement("div"); node.style.display = "contents"; container.current = node; parking.current?.append(node); setReady(true);
    const invalidate = () => {
      epoch.current++; setHubEpoch(epoch.current); reference.current = { scope: "", context: null }; setContext(null);
      try { window.sessionStorage.removeItem(HUB_AI_CONTEXT_STORAGE_KEY); } catch { /* Storage failure cannot authorize an old host. */ }
    };
    window.addEventListener("hub-account-changed", invalidate);
    return () => { window.removeEventListener("hub-account-changed", invalidate); owner.current = null; hosts.current.clear(); container.current = null; node.remove(); };
  }, []);
  const mount = useCallback((host: HTMLElement, props: Registration) => {
    const token = Symbol(), entry = { token, host, props, epoch: epoch.current }; hosts.current.set(token, entry); publish(entry);
    return () => { hosts.current.delete(token); publish(); };
  }, [publish]);
  const update = useCallback((host: HTMLElement, props: Registration) => {
    const entry = [...hosts.current.values()].reverse().find(value => value.host === host);
    if (entry) { const changedScope = entry.props.scope !== props.scope; entry.props = props; entry.epoch = epoch.current; publish(changedScope ? entry : undefined); }
  }, [publish]);
  const value = useMemo(() => ({ ready, mount, update }), [ready, mount, update]);
  return <Workspace.Provider value={value}>
    {children}<div hidden ref={parking} />
    {ready && container.current && presentation ? createPortal(
      <HubSurfaceProvider surface={presentation.surface}><TranslationPreferenceBridge value={presentation.translation}>
        <Suspense fallback={<p role="status">AIを開いています…</p>}>
          <AiWorkbench variant={presentation.kind === "main" ? "page" : "rail"} initialContext={context} handoff={handoff} isActive={active} hostActivation={activation} hubScope={`${presentation.scope}:${hubEpoch}`} />
        </Suspense>
      </TranslationPreferenceBridge></HubSurfaceProvider>, container.current,
    ) : null}
  </Workspace.Provider>;
}

export function V2AiWorkspaceHost({ initialPrompt, ...props }: HostProps & { initialPrompt?: string }) {
  const workspace = useV2AiWorkspace(), host = useRef<HTMLDivElement>(null);
  const surface = useHubUiSurface(), translation = useTranslationPreference();
  const initialDelivery = useMemo(() => initialPrompt ? { key: `ai_prompt:${initialPrompt}`, prompt: initialPrompt, context: null } : undefined, [initialPrompt]);
  const delivery = props.delivery ?? initialDelivery;
  const registration = useRef<Registration>({ ...props, delivery, surface, translation }); registration.current = { ...props, delivery, surface, translation };
  useLayoutEffect(() => {
    if (workspace?.ready && host.current) return workspace.mount(host.current, registration.current);
  }, [workspace?.ready, workspace?.mount]);
  useLayoutEffect(() => {
    if (workspace?.ready && host.current) workspace.update(host.current, registration.current);
  }, [workspace?.ready, workspace?.update, props.kind, props.scope, props.context, props.isActive, delivery, surface, translation]);
  if (!workspace) return <Suspense fallback={<p role="status">AIを開いています…</p>}><AiWorkbench variant={props.kind === "main" ? "page" : "rail"} initialPrompt={initialPrompt ?? delivery?.prompt} initialContext={props.context ?? delivery?.context} isActive={props.isActive} /></Suspense>;
  return <div ref={host} data-ai-workspace-host={props.kind} style={{ display: "contents" }}>{!workspace.ready ? <p role="status">AIを開いています…</p> : null}</div>;
}
