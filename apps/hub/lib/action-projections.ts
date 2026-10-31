import {
  createHubActionProjection,
  publicResourceToken,
  type HubActionProjection,
} from "@/lib/action-layer";

export type PublicWorkActionSource = {
  id: string;
  kind: "job" | "project" | "service";
  title: string;
  organization: string;
  summary: string;
  location: string;
  compensation: string;
};

export function workActionProjection(
  item: PublicWorkActionSource,
  locale: string,
): HubActionProjection {
  const job = item.kind === "job";
  const service = item.kind === "service";
  return createHubActionProjection({
    type: job ? "view_listing" : "accept_task",
    publicResourceRef: `listings:work:${publicResourceToken(item.id)}`,
    ownerService: "listings",
    projectionVersion: "1",
    label: job
      ? locale === "ja" ? "求人" : "Job"
      : service
        ? locale === "ja" ? "スキル出品" : "Service"
        : locale === "ja" ? "業務依頼" : "Project",
    title: item.title,
    description: [item.organization, item.location, item.summary].filter(Boolean).join(" · "),
    priceLabel: item.compensation || null,
    href: `${job ? "/jobs" : "/work"}?listing=${encodeURIComponent(item.id)}`,
    status: "available",
  });
}
