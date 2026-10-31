import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  confirmSolanaTip,
  getSolanaTipRecipient,
  SolanaTipInputError,
  SolanaTipPermissionError,
  SolanaTipUnavailableError,
  SolanaTipVerificationError,
  updateSolanaTipSettings,
} from "@/lib/server/wallet-tips-solana";

const noStore = { "cache-control": "private, no-store" };

/** GET ?handle=&chainRef= -> public receiving addresses of a handle that enabled Solana tips (404 otherwise). */
export async function GET(request: Request) {
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "tips_unavailable" }, { status: 503, headers: noStore });
    const params = new URL(request.url).searchParams;
    const recipient = await getSolanaTipRecipient(database, params.get("handle"), params.get("chainRef"));
    return recipient ? NextResponse.json(recipient, { headers: noStore }) : NextResponse.json({ error: "recipient_not_enabled" }, { status: 404, headers: noStore });
  } catch (error) { return tipError(error); }
}

/** POST { chainRef, signature, recipientHandle } -> { status: "pending" | "confirmed", ... }. Sender and amount are derived server-side. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStore });
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "tips_unavailable" }, { status: 503, headers: noStore });
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { chainRef?: unknown; signature?: unknown; recipientHandle?: unknown } | null;
    if (!body) throw new SolanaTipInputError("invalid_request");
    return NextResponse.json(await confirmSolanaTip({ database, senderProfileId: profile.id, chainRef: body.chainRef, signature: body.signature, recipientHandle: body.recipientHandle }), { headers: noStore });
  } catch (error) { return tipError(error); }
}

/** PATCH { accountId, enabled, minimumLamports, visibility? } -> own tip settings for a verified Solana account. */
export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStore });
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "tips_unavailable" }, { status: 503, headers: noStore });
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { accountId?: unknown; enabled?: unknown; minimumLamports?: unknown; visibility?: unknown } | null;
    if (!body) throw new SolanaTipInputError("invalid_request");
    return NextResponse.json(await updateSolanaTipSettings({ database, profileId: profile.id, accountId: body.accountId, enabled: body.enabled, minimumLamports: body.minimumLamports, visibility: body.visibility }), { headers: noStore });
  } catch (error) { return tipError(error); }
}

function tipError(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: noStore });
  if (error instanceof SolanaTipInputError) return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
  if (error instanceof SolanaTipPermissionError) return NextResponse.json({ error: error.message }, { status: 403, headers: noStore });
  if (error instanceof SolanaTipVerificationError) return NextResponse.json({ error: error.message }, { status: 422, headers: noStore });
  if (error instanceof SolanaTipUnavailableError) return NextResponse.json({ error: error.message }, { status: 503, headers: noStore });
  throw error;
}
