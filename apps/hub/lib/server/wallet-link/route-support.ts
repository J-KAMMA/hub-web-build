import { NextResponse } from "next/server";

import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { WalletLinkError, type WalletLinkErrorCode } from "./link-store";

export const noStoreHeaders = { "cache-control": "private, no-store" };

const STATUS: Record<WalletLinkErrorCode, number> = {
  unsupported_chain: 400,
  malformed_address: 400,
  address_cannot_sign: 400,
  rate_limited: 429,
  challenge_not_found: 404,
  challenge_expired: 410,
  challenge_used: 409,
  wrong_network: 400,
  message_mismatch: 400,
  bad_signature: 400,
  wallet_linked_elsewhere: 409,
};

/** Origin the challenge binds to: the configured public origin, else the (already same-origin checked) request origin. */
export function linkOrigin(request: Request): string | null {
  const configured = process.env.HUB_PUBLIC_ORIGIN?.trim();
  const candidate = configured || request.headers.get("origin");
  if (!candidate) return null;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

export function walletLinkErrorResponse(error: unknown): NextResponse {
  if (error instanceof WalletLinkError) {
    return NextResponse.json({ error: error.code }, { status: STATUS[error.code], headers: noStoreHeaders });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "wallet_link_unavailable" }, { status: 503, headers: noStoreHeaders });
  }
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: noStoreHeaders });
  }
  return NextResponse.json({ error: "wallet_link_failed" }, { status: 502, headers: noStoreHeaders });
}
