import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  confirmSolanaTransaction,
  listActiveSolanaNetworks,
  readSolanaAccountExists,
  readSolanaHistory,
  readSolanaMintInfo,
  readSolanaOverview,
  readSolanaSendContext,
  SolanaWalletInputError,
  SolanaWalletNetworkError,
} from "@/lib/server/solana-wallet";

const noStore = { "cache-control": "private, no-store" };

/**
 * GET ?action=networks | overview (default) | history | send-context | mint | account
 *     &chainRef=solana:...  &address=  &mint=
 * A fixed set of read questions; there is no raw RPC passthrough.
 */
export async function GET(request: Request) {
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "wallet_unavailable" }, { status: 503 });
    await requireHubSessionProfile(request, database);
    const params = new URL(request.url).searchParams;
    const chainRef = params.get("chainRef") ?? undefined;
    switch (params.get("action") ?? "overview") {
      case "networks":
        return NextResponse.json({ networks: listActiveSolanaNetworks() }, { headers: noStore });
      case "history":
        return NextResponse.json({ history: await readSolanaHistory(params.get("address"), chainRef) }, { headers: noStore });
      case "send-context":
        return NextResponse.json(await readSolanaSendContext(chainRef), { headers: noStore });
      case "mint":
        return NextResponse.json(await readSolanaMintInfo(params.get("mint"), chainRef), { headers: noStore });
      case "account":
        return NextResponse.json(await readSolanaAccountExists(params.get("address"), chainRef), { headers: noStore });
      case "overview":
        return NextResponse.json(await readSolanaOverview(params.get("address"), chainRef), { headers: noStore });
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (error) {
    return walletError(error);
  }
}

/** POST { signature, chainRef } -> { status: "pending" | "confirmed" | "finalized" | "failed" } for the sender's own pending-send display. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  try {
    const database = getOptionalHubD1();
    if (!database) return NextResponse.json({ error: "wallet_unavailable" }, { status: 503 });
    await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { signature?: unknown; chainRef?: unknown } | null;
    return NextResponse.json(await confirmSolanaTransaction(body?.signature, body?.chainRef), { headers: noStore });
  } catch (error) {
    return walletError(error);
  }
}

function walletError(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  if (error instanceof SolanaWalletInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof SolanaWalletNetworkError) return NextResponse.json({ error: error.message }, { status: 503 });
  throw error;
}
