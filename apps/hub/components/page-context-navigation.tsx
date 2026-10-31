import React from "react";
import Link from "next/link";
import {
  HUB_SERVICE_GROUPS,
  HUB_SERVICES,
  type HubServiceDefinition,
} from "@/lib/hub-services";

type PageContextNavigationProps = {
  currentPath: string;
};

const ROUTE_ALIASES: ReadonlyArray<{
  prefix: string;
  service: HubServiceDefinition;
}> = [
  {
    prefix: "/market",
    service: {
      id: "market-home",
      label: "マーケット",
      href: "/market",
      iconHref: "/market",
      description: "商品、デジタル作品、チケットを探す",
      group: "market",
      purposes: ["discover"],
      keywords: ["市場"],
    },
  },
  {
    prefix: "/account",
    service: {
      id: "account-home",
      label: "アカウント",
      href: "/account",
      iconHref: "/settings",
      description: "利用情報と取引を管理する",
      group: "account",
      purposes: ["manage"],
      keywords: ["取引"],
    },
  },
];

function matchesPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/profile/me") return pathname.startsWith("/profile/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolvePageContext(pathname: string) {
  // The feed tabs already provide the complete local navigation. Repeating
  // "交流 › フィード" above them consumes the shell title row without adding
  // a useful destination.
  if (pathname === "/feed") return null;
  const candidates = [
    ...HUB_SERVICES.filter(
      (service) =>
        service.pageContext !== false &&
        service.href &&
        matchesPath(pathname, service.href),
    ),
    ...ROUTE_ALIASES
      .filter((alias) => matchesPath(pathname, alias.prefix))
      .map((alias) => alias.service),
  ].sort((left, right) => (right.href?.length ?? 0) - (left.href?.length ?? 0));
  const current = candidates[0];
  if (!current || current.href === "/") return null;
  const group = HUB_SERVICE_GROUPS.find((entry) => entry.id === current.group);
  if (!group) return null;
  const siblings = HUB_SERVICES.filter(
    (service) => service.group === current.group && service.href && service.id !== current.id,
  );
  const isDetail = pathname !== current.href
    && !(current.href === "/profile/me" && pathname.split("/").filter(Boolean).length === 2);
  return { current, group, siblings, isDetail };
}

export function PageContextNavigation({ currentPath }: PageContextNavigationProps) {
  const context = resolvePageContext(currentPath);
  if (!context) return null;
  const { current, group, siblings, isDetail } = context;
  return (
    <section className="page-context" aria-label="ページの現在地">
      <nav className="page-context__breadcrumbs" aria-label="パンくず">
        <Link href={`/services?group=${group.id}`}>{group.label}</Link>
        <span aria-hidden="true">›</span>
        {isDetail && current.href ? (
          <>
            <Link href={current.href}>{current.label}</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">詳細</span>
          </>
        ) : (
          <span aria-current="page">{current.label}</span>
        )}
      </nav>
      <nav className="page-context__siblings" aria-label={`${group.label}の関連ページ`}>
        {siblings.map((service) => (
          <Link key={service.id} href={service.href!}>{service.label}</Link>
        ))}
      </nav>
    </section>
  );
}
