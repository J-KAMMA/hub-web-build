import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import {
  confirmWalletTipForViewer,
  WalletTipInputError,
  WalletTipPendingError,
  WalletTipPermissionError,
  WalletTipVerificationError,
} from "@/lib/server/wallet-tips";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as
    | { recipientHandle?: unknown; txHash?: unknown; chainId?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const result = await confirmWalletTipForViewer({
      request,
      database,
      profile: viewer,
      recipientHandle: body.recipientHandle,
      txHash: body.txHash,
      chainId: body.chainId,
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
    if (error instanceof WalletTipPendingError) {
      return NextResponse.json({ error: error.message }, { status: 202 });
    }
    if (error instanceof WalletTipPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof WalletTipInputError || error instanceof WalletTipVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "confirm_failed" }, { status: 500 });
  }
}
