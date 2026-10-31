import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { verifyAndLinkHubProfileWalletForViewer } from "@/lib/server/hub-wallet-profile-link";
import {
  WalletBalanceInputError,
  WalletBalanceVerificationError,
} from "@/lib/server/wallet-balance-verification";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as
    | {
        challengeId?: unknown;
        address?: unknown;
        typedData?: unknown;
        signature?: unknown;
      }
    | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const result = await verifyAndLinkHubProfileWalletForViewer({
      request,
      database,
      profile: viewer,
      challengeId: body.challengeId,
      address: body.address,
      typedData: body.typedData,
      signature: body.signature,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    if (error instanceof WalletBalanceInputError || error instanceof WalletBalanceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }
}
