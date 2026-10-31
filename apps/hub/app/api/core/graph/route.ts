import { NextRequest, NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getD1HubProfileGraph } from "@/lib/server/d1-hub-graph";
import {
  selectHubGraphSubgraph,
  type HubGraphDomain,
} from "@/lib/platform/hub-graph-projection";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

function readLimit(request: NextRequest) {
  const value = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : 50;
}

const HUB_GRAPH_DOMAINS = new Set<HubGraphDomain>([
  "social",
  "knowledge",
  "commerce",
  "trust",
  "agent",
]);

function readDomain(request: NextRequest): HubGraphDomain | null | "invalid" {
  const value = request.nextUrl.searchParams.get("domain")?.trim();
  if (!value) return null;
  return HUB_GRAPH_DOMAINS.has(value as HubGraphDomain)
    ? value as HubGraphDomain
    : "invalid";
}

export async function GET(request: NextRequest) {
  const profile = request.nextUrl.searchParams.get("profile")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(profile)) {
    return NextResponse.json(
      { error: "profile_required" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const domain = readDomain(request);
  if (domain === "invalid") {
    return NextResponse.json(
      { error: "unsupported_graph_domain" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const graph = await getD1HubProfileGraph(getHubD1(), profile, readLimit(request));
    if (!graph) {
      return NextResponse.json(
        { error: "profile_not_found" },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json({
      version: "hub.core.v1",
      graph: domain ? selectHubGraphSubgraph(graph, domain) : graph,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "hub_graph_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
