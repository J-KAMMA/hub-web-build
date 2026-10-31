"use client";
import { createContext, useContext } from "react";
import type { V2AsideProps } from "./v2-aside";
import type { HubUiSurface } from "@/lib/hub-surface-path";
import type { useTranslationPreference } from "@/components/translation-preference-provider";

export type AsideRegistration = V2AsideProps & {
  surface: HubUiSurface;
  translation: ReturnType<typeof useTranslationPreference>;
};
export type AsideWorkspace = {
  ready: boolean;
  mount: (host: HTMLElement, props: AsideRegistration) => () => void;
  update: (host: HTMLElement, props: AsideRegistration) => void;
};
export const AsideWorkspaceContext = createContext<AsideWorkspace | null>(null);
export const useAsideWorkspace = () => useContext(AsideWorkspaceContext);
