import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  BitcoinTipInputError,
  BitcoinTipPermissionError,
  BitcoinTipUnavailableError,
  BitcoinTipVerificationError,
  confirmBitcoinTip,
  getBitcoinTipRecipient,
  updateBitcoinTipSettings,
} from "@/lib/server/wallet-tips-bitcoin";

const noStore = { "cache-control": "private, no-store" };

/** GET ?handle=&chainRef= -> public receiving addresses of a handle that enabled Bitcoin tips (404 otherwise). */
export async function GET(request: Request) {
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "tips_unavailable" }, { status: 503, headers: noStore });
    const params = new URL(request.url).searchParams;
    const recipient = await getBitcoinTipRecipient(database, params.get("handle"), params.get("chainRef"));
    return recipient ? NextResponse.json(recipient, { headers: noStore }) : NextResponse.json({ error: "recipient_not_enabled" }, { status: 404, headers: noStore });
  } catch (error) { return tipError(error); }
}

/** POST { chainRef, txid, recipientHandle } -> { status: "pending" | "confirmed", ... }. Sender and amount are derived server-side. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStore });
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "tips_unavailable" }, { status: 503, headers: noStore });
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { chainRef?: unknown; txid?: unknown; recipientHandle?: unknown } | null;
    if (!body) throw new BitcoinTipInputError("invalid_request");
    return NextResponse.json(await confirmBitcoinTip({ database, senderProfileId: profile.id, chainRef: body.chainRef, txid: body.txid, recipientHandle: body.recipientHandle }), { headers: noStore });
  } catch (error) { return tipError(error); }
}

/** PATCH { accountId, enabled, minimumSats, visibility? } -> own tip settings for a verified Bitcoin account. */
export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStore });
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "tips_unavailable" }, { status: 503, headers: noStore });
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { accountId?: unknown; enabled?: unknown; minimumSats?: unknown; visibility?: unknown } | null;
    if (!body) throw new BitcoinTipInputError("invalid_request");
    return NextResponse.json(await updateBitcoinTipSettings({ database, profileId: profile.id, accountId: body.accountId, enabled: body.enabled, minimumSats: body.minimumSats, visibility: body.visibility }), { headers: noStore });
  } catch (error) { return tipError(error); }
}

function tipError(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: noStore });
  if (error instanceof BitcoinTipInputError) return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
  if (error instanceof BitcoinTipPermissionError) return NextResponse.json({ error: error.message }, { status: 403, headers: noStore });
  if (error instanceof BitcoinTipVerificationError) return NextResponse.json({ error: error.message }, { status: 422, headers: noStore });
  if (error instanceof BitcoinTipUnavailableError) return NextResponse.json({ error: error.message }, { status: 503, headers: noStore });
  throw error;
}
