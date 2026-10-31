"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import {
  HUB_PAGE_UI_REGISTRY,
  type HubPageKind,
} from "@/lib/generated-page-ui-registry";

function routePattern(route: string) {
  if (route === "/") return /^\/$/;
  const escaped = route
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith("[...") || segment.startsWith("[[...")) return ".+";
      if (segment.startsWith("[") && segment.endsWith("]")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}/?$`);
}

const matchers = HUB_PAGE_UI_REGISTRY.map((entry) => ({
  ...entry,
  pattern: routePattern(entry.route),
}));

export function resolveHubPageUi(pathname: string): {
  kind: HubPageKind;
  route: string;
} {
  const match = matchers.find((entry) => entry.pattern.test(pathname));
  return match
    ? { kind: match.kind, route: match.route }
    : { kind: "listing", route: "unregistered" };
}

export function PageUiScope() {
  const pathname = usePathname();
  const page = useMemo(() => resolveHubPageUi(pathname), [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.pageKind = page.kind;
    root.dataset.pageRoute = page.route;
    return () => {
      delete root.dataset.pageKind;
      delete root.dataset.pageRoute;
    };
  }, [page]);

  return null;
}
