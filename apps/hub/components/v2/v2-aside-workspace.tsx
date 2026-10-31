"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HubSurfaceProvider } from "@/lib/hub-surface-context";
import { TranslationPreferenceBridge } from "@/components/translation-preference-provider";
import { AsideWorkspaceContext, type AsideRegistration } from "./v2-aside-workspace-context";
const V2AsideView = lazy(() => import("./v2-aside").then(module => ({ default: module.V2AsideView })));

/** One portal container survives page shells; old cleanup cannot reclaim a new host. */
export function V2AsideWorkspaceProvider({ children }: { children: ReactNode }) {
  const parking = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const owner = useRef<{ token: symbol; host: HTMLElement } | null>(null);
  const [ready, setReady] = useState(false);
  const [props, setProps] = useState<AsideRegistration | null>(null);
  const [connected, setConnected] = useState(false);
  useLayoutEffect(() => {
    const node = document.createElement("div"); node.className = "v2__aside-slot";
    container.current = node; parking.current?.append(node); setReady(true);
    return () => { owner.current = null; container.current = null; node.remove(); };
  }, []);
  const mount = useCallback((host: HTMLElement, next: AsideRegistration) => {
    const node = container.current;
    if (!node) return () => {};
    const token = Symbol(); owner.current = { token, host };
    host.append(node); setProps(next); setConnected(true);
    return () => {
      if (owner.current?.token !== token) return;
      owner.current = null; parking.current?.append(node); setConnected(false);
    };
  }, []);
  const update = useCallback((host: HTMLElement, next: AsideRegistration) => {
    if (owner.current?.host === host) setProps(next);
  }, []);
  const value = useMemo(() => ({ ready, mount, update }), [ready, mount, update]);
  const attached = useCallback(() => Boolean(owner.current?.host.isConnected && container.current?.parentElement === owner.current.host), []);
  return <AsideWorkspaceContext.Provider value={value}>
    {children}
    <div hidden ref={parking} />
    {ready && container.current && props ? createPortal(
      <HubSurfaceProvider surface={props.surface}>
        <TranslationPreferenceBridge value={props.translation}>
          <Suspense fallback={<><p className="v2-sr" role="status">{props.japanese ? "作業を準備しています…" : "Preparing workspace…"}</p><div className="v2__aside-strip" data-pending="true" /></>}>
            <V2AsideView {...props} connected={connected} attached={attached} />
          </Suspense>
        </TranslationPreferenceBridge>
      </HubSurfaceProvider>, container.current,
    ) : null}
  </AsideWorkspaceContext.Provider>;
}
