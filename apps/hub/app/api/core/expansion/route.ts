import { NextResponse } from "next/server";

import {
  HUB_EXPANSION_POLICY_VERSION,
  hubCoreFunctions,
  hubExpansionCapabilities,
  selectiveInfrastructureCandidates,
  selectiveInfrastructureEntryCriteria,
} from "@/lib/platform/expansion-policy";

export async function GET() {
  return NextResponse.json(
    {
      version: HUB_EXPANSION_POLICY_VERSION,
      coreFunctions: hubCoreFunctions,
      capabilities: hubExpansionCapabilities,
      selectiveInfrastructure: {
        candidates: selectiveInfrastructureCandidates,
        entryCriteria: selectiveInfrastructureEntryCriteria,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
