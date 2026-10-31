import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { formatEther, type Hash } from "viem";
import {
  createHubPublicClient,
  getHubEvmNetworkByChainId,
} from "@/lib/server/wallet-balance-verification";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export class WalletActivityInputError extends Error {}
export class WalletActivityPendingError extends Error {}
export class WalletActivityVerificationError extends Error {}

function hash(value: unknown): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new WalletActivityInputError("取引ハッシュが正しくありません。");
  return value as Hash;
}

export async function confirmWalletActivity(input: {
  request: Request;
  database: D1Database;
  txHash: unknown;
  chainId: unknown;
}) {
  const profile = await requireHubSessionProfile(input.request, input.database);
  const txHash = hash(input.txHash);
  const chainId = Number(input.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new WalletActivityInputError("チェーンIDが正しくありません。");
  const network = getHubEvmNetworkByChainId(chainId);
  const existing = await input.database
    .prepare(
      "SELECT id FROM wallet_activity WHERE tx_hash = ? AND profile_id = ? LIMIT 1",
    )
    .bind(txHash, profile.id)
    .first<{ id: string }>();
  if (existing) return { id: existing.id, confirmed: true };
  const client = createHubPublicClient(chainId);
  let transaction;
  let receipt;
  try {
    [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);
  } catch {
    throw new WalletActivityPendingError(
      "取引の承認待ちです。確定後に履歴へ追加されます。",
    );
  }
  if (receipt.status !== "success")
    throw new WalletActivityVerificationError(
      "失敗した取引は履歴へ追加できません。",
    );
  const linked = await input.database
    .prepare(
      "SELECT 1 AS linked FROM profile_wallet_links WHERE profile_id = ? AND wallet_address = ? AND chain_id = ? LIMIT 1",
    )
    .bind(profile.id, transaction.from, chainId)
    .first<{ linked: number }>();
  if (!linked)
    throw new WalletActivityVerificationError(
      "送信元が署名検証済みウォレットと一致しません。",
    );
  const activityType = transaction.input === "0x" ? "transfer" : "contract";
  const now = new Date().toISOString();
  const id = `wallet-activity-${crypto.randomUUID()}`;
  await input.database
    .prepare(
      `INSERT INTO wallet_activity
      (id, profile_id, tx_hash, chain_id, network, activity_type, asset_symbol, amount_wei, confirmed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      profile.id,
      txHash,
      chainId,
      network.chain.name,
      activityType,
      network.chain.nativeCurrency.symbol,
      transaction.value.toString(),
      now,
      now,
    )
    .run();
  return { id, confirmed: true };
}

export async function listWalletActivity(
  request: Request,
  database: D1Database,
) {
  const profile = await requireHubSessionProfile(request, database);
  const result = await database
    .prepare(
      `SELECT id, tx_hash, chain_id, network, activity_type, asset_symbol, amount_wei, confirmed_at
      FROM wallet_activity WHERE profile_id = ? ORDER BY confirmed_at DESC LIMIT 100`,
    )
    .bind(profile.id)
    .all<{
      id: string;
      tx_hash: string;
      chain_id: number;
      network: string;
      activity_type: "transfer" | "contract";
      asset_symbol: string;
      amount_wei: string;
      confirmed_at: string;
    }>();
  return {
    activity: result.results.map((row) => {
      const explorer = getHubEvmNetworkByChainId(Number(row.chain_id)).chain
        .blockExplorers?.default.url;
      return {
        id: row.id,
        txHash: row.tx_hash,
        network: row.network,
        type: row.activity_type,
        symbol: row.asset_symbol,
        amount: formatEther(BigInt(row.amount_wei)),
        confirmedAt: row.confirmed_at,
        explorerUrl: explorer ? `${explorer}/tx/${row.tx_hash}` : null,
      };
    }),
  };
}
