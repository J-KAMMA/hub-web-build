import { NextResponse } from "next/server";

import { getInstanceOrigin } from "@/lib/instance-origin";
import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { issueWorkCommerceTicket, syncWorkContractState } from "@/lib/server/d1-work";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { workCommerceHandoffUrl } from "@/lib/server/work-commerce-ticket";
import { WORK_HEADERS, readWorkJson, rejectWorkRequest, workErrorResponse, workStateDeps, workTicketKey } from "@/lib/server/work-route";

export const dynamic = "force-dynamic";

/**
 * { purpose }. Hub checks that the caller is the right side and that Commerce's last signed state allows the
 * action, then signs a single-use `jkamma-commerce-work` ticket. The browser opens `url` (the ticket is in the
 * fragment) at Commerce, which asks the wallet to sign. Hub never receives the payment.
 */
export async function POST(request: Request, context: { params: Promise<{ contractId: string }> }) {
  const rejected = rejectWorkRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { contractId } = await context.params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const body = await readWorkJson(request);
    await syncWorkContractState(database, contractId, workStateDeps(), contentFileDepsFromEnv());
    const signed = await issueWorkCommerceTicket(database, profile.id, contractId, body.purpose, workTicketKey());
    return NextResponse.json(
      { purpose: signed.claims.purpose, expiresAt: signed.expiresAt, url: workCommerceHandoffUrl(getInstanceOrigin(), signed.ticket) },
      { headers: WORK_HEADERS },
    );
  } catch (error) {
    return workErrorResponse(error);
  }
}
