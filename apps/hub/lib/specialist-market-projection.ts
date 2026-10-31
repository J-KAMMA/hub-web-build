import {
  createHubActionProjection,
  publicResourceToken,
  type HubActionProjection,
} from "@/lib/action-layer";

export const SPECIALIST_SERVICE_OWNERS = [
  "data",
  "compute",
  "research",
  "listings",
] as const;

export type SpecialistServiceOwner =
  (typeof SPECIALIST_SERVICE_OWNERS)[number];

export type SpecialistRightsProjection = {
  authority: SpecialistServiceOwner;
  access: "open" | "paid" | "restricted" | "external";
  label: string;
  verifiedAt: string | null;
};

export type SpecialistTrustProjection = {
  source: SpecialistServiceOwner | "commerce";
  status: "verified" | "pending" | "not_available";
  label: string;
  observedAt: string | null;
};

export type SpecialistCommerceProjection = {
  owner: "commerce" | "external-provider" | "none";
  mode: "direct-order" | "funding-grant" | "external-link" | "free";
  priceLabel: string | null;
};

export type SpecialistMarketProjection = {
  service: SpecialistServiceOwner;
  action: HubActionProjection;
  rights: SpecialistRightsProjection;
  commerce: SpecialistCommerceProjection;
  trust: SpecialistTrustProjection;
  searchText: string;
};

type CommonSource = {
  id: string;
  title: string;
  summary: string;
  href: string | null;
  priceLabel?: string | null;
  trustStatus?: SpecialistTrustProjection["status"];
  observedAt?: string | null;
};

export type DatasetProjectionSource = CommonSource & {
  version: string;
  license: string;
  qualityLabel: string;
  access: Exclude<SpecialistRightsProjection["access"], "external">;
  rightsVerifiedAt?: string | null;
};

export type ComputeProjectionSource = CommonSource & {
  resourceLabel: string;
  isolated: boolean;
  fundingAvailable: boolean;
};

export type ResearchProjectionSource = CommonSource & {
  researchKind: "paper" | "project" | "challenge" | "replication";
  participation: "open" | "reviewed" | "closed";
};

export type ListingProjectionSource = CommonSource & {
  listingKind:
    | "real-estate"
    | "vehicles"
    | "travel"
    | "local-services"
    | "classes"
    | "events";
  providerLabel: string;
  external: boolean;
};

function cleanSearchText(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 640);
}

function trust(
  source: SpecialistTrustProjection["source"],
  status: SpecialistTrustProjection["status"],
  observedAt: string | null | undefined,
): SpecialistTrustProjection {
  return {
    source,
    status,
    label:
      status === "verified"
        ? "確認済み"
        : status === "pending"
          ? "確認中"
          : "確認情報なし",
    observedAt: observedAt ?? null,
  };
}

export function datasetMarketProjection(
  source: DatasetProjectionSource,
): SpecialistMarketProjection {
  const usable = source.access !== "restricted" && Boolean(source.href);
  return {
    service: "data",
    action: createHubActionProjection({
      type: "use_dataset",
      publicResourceRef: `data:dataset:${publicResourceToken(source.id)}`,
      ownerService: "data",
      projectionVersion: "1",
      label: `データセット v${source.version}`,
      title: source.title,
      description: `${source.summary} · ${source.qualityLabel}`,
      priceLabel: source.priceLabel ?? null,
      href: usable ? source.href : null,
      status: usable ? "available" : "unavailable",
      statusLabel: usable ? undefined : "アクセス条件を確認できません",
    }),
    rights: {
      authority: "data",
      access: source.access,
      label: source.license,
      verifiedAt: source.rightsVerifiedAt ?? null,
    },
    commerce: {
      owner: source.access === "paid" ? "commerce" : "none",
      mode: source.access === "paid" ? "direct-order" : "free",
      priceLabel: source.priceLabel ?? null,
    },
    trust: trust("data", source.trustStatus ?? "not_available", source.observedAt),
    searchText: cleanSearchText([
      source.title,
      source.summary,
      source.version,
      source.license,
      source.qualityLabel,
    ]),
  };
}

export function computeMarketProjection(
  source: ComputeProjectionSource,
): SpecialistMarketProjection {
  const usable = source.isolated && source.fundingAvailable && Boolean(source.href);
  return {
    service: "compute",
    action: createHubActionProjection({
      type: "submit_compute",
      publicResourceRef: `compute:offer:${publicResourceToken(source.id)}`,
      ownerService: "compute",
      projectionVersion: "1",
      label: source.resourceLabel,
      title: source.title,
      description: source.summary,
      priceLabel: source.priceLabel ?? null,
      href: usable ? source.href : null,
      status: usable ? "available" : "unavailable",
      statusLabel: source.isolated
        ? "資金確保を利用できません"
        : "隔離実行を確認できません",
    }),
    rights: {
      authority: "compute",
      access: source.priceLabel ? "paid" : "open",
      label: "承認済みテンプレート",
      verifiedAt: source.isolated ? source.observedAt ?? null : null,
    },
    commerce: {
      owner: source.priceLabel ? "commerce" : "none",
      mode: source.priceLabel ? "funding-grant" : "free",
      priceLabel: source.priceLabel ?? null,
    },
    trust: trust("compute", source.trustStatus ?? "not_available", source.observedAt),
    searchText: cleanSearchText([
      source.title,
      source.summary,
      source.resourceLabel,
    ]),
  };
}

export function researchMarketProjection(
  source: ResearchProjectionSource,
): SpecialistMarketProjection {
  const usable = source.participation !== "closed" && Boolean(source.href);
  const kindLabel = {
    paper: "論文",
    project: "研究プロジェクト",
    challenge: "研究課題",
    replication: "再現実験",
  }[source.researchKind];
  return {
    service: "research",
    action: createHubActionProjection({
      type: "join_research",
      publicResourceRef: `research:work:${publicResourceToken(source.id)}`,
      ownerService: "research",
      projectionVersion: "1",
      label: kindLabel,
      title: source.title,
      description: source.summary,
      priceLabel: source.priceLabel ?? null,
      href: usable ? source.href : null,
      status: usable ? "available" : "read_only",
      statusLabel: usable ? undefined : "閲覧のみ",
    }),
    rights: {
      authority: "research",
      access: source.participation === "open" ? "open" : "restricted",
      label: source.participation === "open" ? "参加受付中" : "参加審査あり",
      verifiedAt: source.observedAt ?? null,
    },
    commerce: {
      owner: source.priceLabel ? "commerce" : "none",
      mode: source.priceLabel ? "direct-order" : "free",
      priceLabel: source.priceLabel ?? null,
    },
    trust: trust("research", source.trustStatus ?? "not_available", source.observedAt),
    searchText: cleanSearchText([
      source.title,
      source.summary,
      kindLabel,
      source.participation,
    ]),
  };
}

export function listingMarketProjection(
  source: ListingProjectionSource,
): SpecialistMarketProjection {
  const usable = source.external && Boolean(source.href);
  return {
    service: "listings",
    action: createHubActionProjection({
      type: "view_listing",
      publicResourceRef: `listings:${source.listingKind}:${publicResourceToken(source.id)}`,
      ownerService: "listings",
      projectionVersion: "1",
      label: source.providerLabel,
      title: source.title,
      description: source.summary,
      priceLabel: source.priceLabel ?? null,
      href: usable ? source.href : null,
      status: usable ? "available" : "read_only",
      statusLabel: usable ? "掲載元で確認" : "掲載情報のみ",
    }),
    rights: {
      authority: "listings",
      access: "external",
      label: "掲載元が契約・決済を管理",
      verifiedAt: source.observedAt ?? null,
    },
    commerce: {
      owner: "external-provider",
      mode: "external-link",
      priceLabel: source.priceLabel ?? null,
    },
    trust: trust("listings", source.trustStatus ?? "not_available", source.observedAt),
    searchText: cleanSearchText([
      source.title,
      source.summary,
      source.providerLabel,
      source.listingKind,
    ]),
  };
}
