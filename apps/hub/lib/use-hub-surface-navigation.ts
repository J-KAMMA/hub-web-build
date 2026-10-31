"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

type HubNavigationOptions = {
  replace?: boolean;
  refresh?: boolean;
};

/**
 * Preserve conventional full-page navigation on the web while keeping the
 * installed app inside its already connected WebView.
 */
export function useHubSurfaceNavigation() {
  const router = useRouter();

  return useCallback((href: string, options: HubNavigationOptions = {}) => {
    const appSurface = document.documentElement.dataset.hubSurface === "app";
    if (appSurface) {
      if (options.replace) router.replace(href);
      else router.push(href);
      if (options.refresh) window.setTimeout(() => router.refresh(), 0);
      return;
    }
    if (options.replace) window.location.replace(href);
    else window.location.assign(href);
  }, [router]);
}
