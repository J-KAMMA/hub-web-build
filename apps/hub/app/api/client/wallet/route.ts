import { NextResponse } from "next/server";
import { formatEther } from "viem";
import { arbitrum, base, mainnet, optimism, polygon, polygonAmoy } from "viem/chains";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getHubEvmNetworkByChainId } from "@/lib/server/wallet-balance-verification";

const explorers = new Map([arbitrum, base, mainnet, optimism, polygon, polygonAmoy]
  .map((chain) => [Number(chain.id), chain.blockExplorers.default.url]));

/**
 * クライアント向けウォレットの読み取り面。連携済みウォレット・
 * 署名確認済みリンク・最近のオンチェーン履歴をまとめて返す。
 * 読み取りだけ——送金やリンクの変更はWebの専用面に残す。
 * クエリは /api/wallet/* の読み取り側と同じ形に揃える。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const [accountsResult, linksResult, activityResult] = await Promise.all([
      database.prepare(`SELECT a.id, a.namespace, a.display_address address,
          a.verification_status verificationStatus, a.visibility, a.verified_at verifiedAt,
          a.created_at createdAt, GROUP_CONCAT(n.network_reference) networks
        FROM profile_wallet_accounts a
        LEFT JOIN wallet_account_networks n ON n.wallet_account_id = a.id AND n.enabled = 1
        WHERE a.profile_id = ? GROUP BY a.id ORDER BY a.created_at DESC`)
        .bind(viewer.id)
        .all<{ networks: string | null }>(),
      database.prepare(`SELECT wallet_address, chain_id, network, visibility,
          verified_at, last_balance_refresh_at
        FROM profile_wallet_links
        WHERE profile_id = ? AND active = 1
        ORDER BY verified_at DESC`)
        .bind(viewer.id)
        .all<{
          wallet_address: string;
          chain_id: number;
          network: string;
          visibility: "private" | "public";
          verified_at: string;
          last_balance_refresh_at: string;
        }>(),
      database.prepare(`SELECT id, tx_hash, chain_id, network, activity_type,
          asset_symbol, amount_wei, confirmed_at
        FROM wallet_activity WHERE profile_id = ?
        ORDER BY confirmed_at DESC LIMIT 50`)
        .bind(viewer.id)
        .all<{
          id: string;
          tx_hash: string;
          chain_id: number;
          network: string;
          activity_type: "transfer" | "contract";
          asset_symbol: string;
          amount_wei: string;
          confirmed_at: string;
        }>(),
    ]);
    return NextResponse.json({
      accounts: accountsResult.results.map((row) => ({
        ...row,
        networks: row.networks ? row.networks.split(",") : [],
      })),
      links: linksResult.results.map((row) => ({
        address: row.wallet_address,
        chainId: Number(row.chain_id),
        network: row.network,
        visibility: row.visibility,
        verifiedAt: row.verified_at,
        lastBalanceRefreshAt: row.last_balance_refresh_at,
      })),
      activity: activityResult.results.map((row) => {
        const chainId = getHubEvmNetworkByChainId(Number(row.chain_id)).chain.id;
        const explorer = explorers.get(chainId);
        return {
          id: row.id,
          txHash: row.tx_hash,
          chainId,
          network: row.network,
          type: row.activity_type,
          symbol: row.asset_symbol,
          amount: formatEther(BigInt(row.amount_wei)),
          confirmedAt: row.confirmed_at,
          explorerUrl: explorer ? `${explorer}/tx/${row.tx_hash}` : null,
        };
      }),
    }, { headers: { "cache-control": "no-store" } });
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
    throw error;
  }
}
