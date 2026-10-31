import { NextResponse } from "next/server";

import { isOptionalServiceEnabled } from "@/lib/optional-services";

/**
 * Research-funding tokens (DeSci: token registration, the supporter gate, the in-Hub GohoToken purchase and the
 * fund reports) stay off until the legal review is answered. Default off; on only with HUB_RESEARCH_TOKEN_ENABLED
 * on a jkamma-operated Hub. Read-only research pages are not affected.
 */
export function researchTokenEnabled(): boolean {
  return isOptionalServiceEnabled("research-token");
}

/** A 404 while the feature is off (absent, not temporarily down), or null when it is on. */
export function rejectResearchToken(): NextResponse | null {
  return researchTokenEnabled() ? null : NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}
