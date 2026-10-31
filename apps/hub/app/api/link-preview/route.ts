import { NextResponse } from "next/server";

import { LinkPreviewError } from "@/lib/link-preview-url";
import { getPublicLinkPreview } from "@/lib/server/public-link-preview";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  createHubActionProjection,
  publicResourceToken,
} from "@/lib/action-layer";
import {
  getLinkPreviewCacheControl,
  type LinkPreview,
} from "@/lib/link-preview";
import {
  classifyHubInternalActionUrl,
  aiInternalActionProjection,
  unavailableInternalActionProjection,
} from "@/lib/hub-internal-action-url";
import { getD1WorkListing } from "@/lib/server/d1-work-listings";
import { workActionProjection } from "@/lib/action-projections";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";
  const database = getOptionalHubD1();
  const internalTarget = classifyHubInternalActionUrl(rawUrl);
  if (internalTarget) {
    let action;
    if (internalTarget.kind === "work") {
      const listing = database
        ? await getD1WorkListing(database, internalTarget.listingId)
        : null;
      action = listing
        ? workActionProjection(
            {
              id: listing.id,
              kind:
                listing.kind === "job"
                  ? "job"
                  : listing.kind === "service"
                    ? "service"
                    : "project",
              title: listing.title,
              organization: listing.ownerName,
              summary: listing.summary,
              location: listing.location,
              compensation: listing.compensationLabel,
            },
            "ja",
          )
        : createHubActionProjection({
            type: internalTarget.workKind === "job" ? "apply" : "accept_task",
            publicResourceRef: `listings:work:${publicResourceToken(internalTarget.listingId)}`,
            ownerService: "listings",
            projectionVersion: "1",
            label: internalTarget.workKind === "job" ? "求人" : "業務依頼",
            title:
              internalTarget.workKind === "job"
                ? "求人情報"
                : "クラウドソーシング",
            description: "公開状態を確認できませんでした。",
            href: null,
            status: "unavailable",
            statusLabel: "掲載状態を確認できません",
          });
    } else if (internalTarget.kind === "ai") {
      action = aiInternalActionProjection(internalTarget);
    } else {
      action = unavailableInternalActionProjection(internalTarget);
    }
    const response: LinkPreview = {
      url: rawUrl,
      siteName: "Hub",
      title: action.title,
      description: action.description ?? "",
      imageUrl: action.imageUrl ?? null,
      action,
    };
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": getLinkPreviewCacheControl(response, {
          fallback: action.status !== "available",
        }),
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  try {
    const response: LinkPreview = await getPublicLinkPreview(rawUrl, { database });
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": getLinkPreviewCacheControl(response),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status =
      error instanceof LinkPreviewError &&
      ["invalid_url", "unsafe_url"].includes(error.code)
        ? 400
        : 502;
    return NextResponse.json(
      {
        error:
          status === 400
            ? "このURLはプレビューできません。"
            : "リンク情報を取得できませんでした。",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
