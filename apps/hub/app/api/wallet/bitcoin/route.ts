import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  BitcoinWalletInputError,
  BitcoinWalletNetworkError,
  BitcoinWalletVerificationError,
  broadcastBitcoinSend,
  readBitcoinFeeRates,
  readBitcoinHistory,
  readBitcoinOverview,
  readBitcoinUtxos,
} from "@/lib/server/bitcoin-wallet";
import type { ExpectedSend } from "@/lib/wallet/bitcoin-psbt";

const noStore = { "cache-control": "private, no-store" };

/** GET ?view=overview|utxos|fees|history&chainRef=bip122:...&address=... (session required). Read-only; display and send preparation. */
export async function GET(request: Request) {
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "wallet_unavailable" }, { status: 503, headers: noStore });
    await requireHubSessionProfile(request, database);
    const params = new URL(request.url).searchParams;
    const chainRef = params.get("chainRef");
    const address = params.get("address");
    const view = params.get("view") ?? "overview";
    if (view === "fees") return NextResponse.json(await readBitcoinFeeRates({ chainRef }), { headers: noStore });
    if (view === "utxos") return NextResponse.json(await readBitcoinUtxos({ chainRef, address }), { headers: noStore });
    if (view === "history") return NextResponse.json(await readBitcoinHistory({ chainRef, address }), { headers: noStore });
    return NextResponse.json(await readBitcoinOverview({ chainRef, address }), { headers: noStore });
  } catch (error) { return walletError(error); }
}

/**
 * POST { chainRef, from, psbtBase64 | rawHex, expected } -> { txid }. Relays a transaction the user's wallet already
 * signed, after re-checking it against the values the user confirmed. Tip confirmation lives in /api/wallet/tips/bitcoin.
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403, headers: noStore });
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "wallet_unavailable" }, { status: 503, headers: noStore });
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { chainRef?: unknown; from?: unknown; psbtBase64?: unknown; rawHex?: unknown; expected?: ExpectedSend } | null;
    if (!body || !body.expected || typeof body.expected !== "object") throw new BitcoinWalletInputError("送信内容がありません。");
    const signed = {
      ...(typeof body.psbtBase64 === "string" && body.psbtBase64.length < 200_000 ? { psbtBase64: body.psbtBase64 } : {}),
      ...(typeof body.rawHex === "string" && body.rawHex.length < 400_000 ? { rawHex: body.rawHex } : {}),
    };
    return NextResponse.json(await broadcastBitcoinSend({ database, profileId: profile.id, chainRef: body.chainRef, from: body.from, signed, expected: body.expected }), { headers: noStore });
  } catch (error) { return walletError(error); }
}

function walletError(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: noStore });
  if (error instanceof BitcoinWalletInputError) return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
  if (error instanceof BitcoinWalletVerificationError) return NextResponse.json({ error: error.message }, { status: 422, headers: noStore });
  if (error instanceof BitcoinWalletNetworkError) return NextResponse.json({ error: error.message }, { status: 503, headers: noStore });
  throw error;
}
