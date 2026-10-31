import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { formatEther, getAddress, parseEther, type Hash } from "viem";

import {
  createHubPublicClient,
  getHubEvmNetworkByChainId,
} from "@/lib/server/wallet-balance-verification";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export class WalletTipInputError extends Error {}
export class WalletTipPermissionError extends Error {}
export class WalletTipPendingError extends Error {}
export class WalletTipVerificationError extends Error {}

type WalletLinkRow = {
  id: string;
  profile_id: string;
  wallet_address: string;
  chain_id: number;
  network: string;
  tips_enabled: number;
  minimum_tip_wei: string;
  visibility: "public" | "private";
  verified_at: string;
};

function normalizeAddress(value: unknown) {
  if (typeof value !== "string" || value.length !== 42 || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new WalletTipInputError("ウォレットアドレスが正しくありません。");
  }
  try { return getAddress(value); }
  catch { throw new WalletTipInputError("ウォレットアドレスが正しくありません。"); }
}

function normalizeHash(value: unknown): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new WalletTipInputError("トランザクションハッシュが正しくありません。");
  }
  return value as Hash;
}

function normalizeHandle(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_]{1,32}$/.test(value)) {
    throw new WalletTipInputError("プロフィールが正しくありません。");
  }
  return value;
}

function storedTipAmount(value: unknown) {
  if (typeof value !== "string" || !value.length || value.length > 78 || /[^0-9]/.test(value)
    || BigInt(value) > (1n << 256n) - 1n) throw new WalletTipVerificationError("受取設定を確認できません。");
  return formatEther(BigInt(value));
}
function validTipVerificationTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || /\p{Cc}/u.test(value)
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})| \d{2}:\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function verifiedTipLink(row: WalletLinkRow) {
  if (!Number.isSafeInteger(row.chain_id) || row.chain_id <= 0 || ![0, 1].includes(row.tips_enabled)
    || !["public", "private"].includes(row.visibility) || !validTipVerificationTime(row.verified_at)) {
    throw new WalletTipPermissionError("ウォレットの所有確認を検証できません。");
  }
  storedTipAmount(row.minimum_tip_wei);
}

/** Only the receiving settings envelope; never accepts an owner, row id or authoritative balance. */
export async function readTipSettingsInput(request: Request, requireChainId = false): Promise<Record<string, unknown>> {
  const invalid = (): never => { throw new WalletTipInputError("受取設定の入力が正しくありません。"); };
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return invalid();
  const reader = request.body?.getReader(); if (!reader) return invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true }); let value = "", size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) { await reader.cancel().catch(() => {}); return invalid(); }
      value += decoder.decode(chunk.value, { stream: true });
    }
    value += decoder.decode();
  } catch { await reader.cancel().catch(() => {}); return invalid(); }
  finally { reader.releaseLock(); }
  let decoded: unknown; try { decoded = JSON.parse(value); } catch { return invalid(); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return invalid();
  const body = decoded as Record<string, unknown>;
  if (Object.keys(body).some(key => !["address", "chainId", "enabled", "minimumAmount", "publishAddress"].includes(key))
    || !Object.hasOwn(body, "address") || requireChainId && !Object.hasOwn(body, "chainId")) return invalid();
  return body;
}

export async function getOwnTipSettings(
  request: Request,
  database: D1Database,
) {
  const profile = await requireHubSessionProfile(request, database);
  return getOwnTipSettingsForViewer(profile, database);
}

export async function getOwnTipSettingsForViewer(
  profile: { id: string },
  database: D1Database,
  maximumLinks?: 100,
) {
  const result = await database.prepare(`SELECT id, profile_id, wallet_address,
      chain_id, network, tips_enabled, minimum_tip_wei, visibility, verified_at
      FROM profile_wallet_links
      WHERE profile_id = ? AND active = 1 AND unlinked_at IS NULL
      ORDER BY verified_at DESC, id DESC${maximumLinks === undefined ? "" : " LIMIT 101"}`)
    .bind(profile.id)
    .all<WalletLinkRow>();
  if (maximumLinks !== undefined && result.results.length > maximumLinks) throw new WalletTipVerificationError("受取設定の件数を確認できません。");
  const links = result.results.map((row) => {
      verifiedTipLink(row);
      if (typeof row.network !== "string" || row.network.length > 120 || !row.network.trim() || /\p{Cc}/u.test(row.network)) {
        throw new WalletTipVerificationError("受取設定を確認できません。");
      }
      return {
      address: normalizeAddress(row.wallet_address),
      chainId: Number(row.chain_id),
      network: row.network,
      symbol: getHubEvmNetworkByChainId(Number(row.chain_id)).chain.nativeCurrency.symbol,
      tipsEnabled: Boolean(row.tips_enabled),
      minimumAmount: storedTipAmount(row.minimum_tip_wei),
      visibility: row.visibility,
    }; });
  if (new Set(links.map(link => `${link.chainId}:${link.address.toLowerCase()}`)).size !== links.length) {
    throw new WalletTipVerificationError("受取設定を確認できません。");
  }
  return { links };
}

export async function updateOwnTipSettings(input: {
  request: Request;
  database: D1Database;
  address: unknown;
  chainId?: unknown;
  enabled?: unknown;
  minimumAmount?: unknown;
  publishAddress?: unknown;
}) {
  const profile = await requireHubSessionProfile(input.request, input.database);
  return updateOwnTipSettingsForViewer({ ...input, profile });
}

export async function updateOwnTipSettingsForViewer(input: {
  request: Request;
  database: D1Database;
  address: unknown;
  chainId?: unknown;
  enabled?: unknown;
  minimumAmount?: unknown;
  publishAddress?: unknown;
  profile: { id: string };
}) {
  const { profile } = input;
  const address = normalizeAddress(input.address);
  if (input.enabled === undefined && input.minimumAmount === undefined
    || input.enabled !== undefined && typeof input.enabled !== "boolean"
    || input.publishAddress !== undefined && typeof input.publishAddress !== "boolean"
    || input.enabled === true && input.publishAddress !== true) {
    throw new WalletTipInputError("投げ銭設定が正しくありません。");
  }
  if (input.chainId !== undefined && (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId <= 0)) {
    throw new WalletTipInputError("受取chainの指定が正しくありません。");
  }
  let minimumWei: bigint | undefined;
  if (input.minimumAmount !== undefined) {
    if (typeof input.minimumAmount !== "string" || input.minimumAmount.length > 100
      || !/^\d+(\.\d{0,18})?$/.test(input.minimumAmount) || /[^0-9.]/.test(input.minimumAmount)) {
      throw new WalletTipInputError("最低金額が正しくありません。");
    }
    try { minimumWei = parseEther(input.minimumAmount); }
    catch { throw new WalletTipInputError("最低金額が正しくありません。"); }
    if (minimumWei < 0n || minimumWei > (1n << 256n) - 1n) throw new WalletTipInputError("最低金額が正しくありません。");
  }
  const links = await input.database.prepare(`SELECT id, chain_id, verified_at, tips_enabled, minimum_tip_wei, visibility
      FROM profile_wallet_links
      WHERE profile_id = ? AND wallet_address = ? AND active = 1 AND unlinked_at IS NULL
        ${input.chainId === undefined ? "" : "AND chain_id = ?"} LIMIT 2`)
    .bind(profile.id, address, ...(input.chainId === undefined ? [] : [input.chainId]))
    .all<WalletLinkRow>();
  if (links.results.length > 1) throw new WalletTipInputError("受取chainを指定してください。");
  const ownedLink = links.results[0];
  if (!ownedLink) {
    throw new WalletTipPermissionError(
      "このアカウントに紐づいたウォレットではありません。",
    );
  }
  verifiedTipLink(ownedLink);
  const symbol = getHubEvmNetworkByChainId(Number(ownedLink.chain_id)).chain.nativeCurrency.symbol;
  const saved = await input.database.prepare(`UPDATE profile_wallet_links SET
      minimum_tip_wei = CASE WHEN ? THEN ? ELSE minimum_tip_wei END,
      tips_enabled = CASE WHEN ? THEN ? ELSE tips_enabled END,
      visibility = CASE WHEN ? THEN ? ELSE visibility END
      WHERE profile_id = ? AND id = ? AND wallet_address = ? AND chain_id = ?
        AND active = 1 AND unlinked_at IS NULL AND verified_at = ?
      RETURNING wallet_address,chain_id,tips_enabled,minimum_tip_wei,visibility`)
    .bind(minimumWei !== undefined ? 1 : 0, minimumWei?.toString() ?? "0",
      input.enabled !== undefined ? 1 : 0, input.enabled === true ? 1 : 0,
      input.enabled !== undefined ? 1 : 0, input.enabled === true ? "public" : "private",
      profile.id, ownedLink.id, address, ownedLink.chain_id, ownedLink.verified_at)
    .first<WalletLinkRow>();
  if (!saved) throw new WalletTipPermissionError("ウォレットの所有確認を検証できません。");
  return {
    address,
    chainId: Number(saved.chain_id),
    tipsEnabled: Boolean(saved.tips_enabled),
    minimumAmount: formatEther(BigInt(saved.minimum_tip_wei || "0")),
    visibility: saved.visibility,
    symbol,
  };
}

export async function getPublicTipRecipient(
  database: D1Database,
  handleValue: unknown,
) {
  const handle = normalizeHandle(handleValue);
  const profile = await database.prepare(`SELECT id, handle, display_name
      FROM profiles p
      WHERE p.handle = ?
      LIMIT 1`)
    .bind(handle)
    .first<{ id: string; handle: string; display_name: string }>();
  if (!profile) throw new WalletTipInputError("プロフィールが見つかりません。");
  const result = await database.prepare(`SELECT id, profile_id, wallet_address,
      chain_id, network, tips_enabled, minimum_tip_wei, visibility, verified_at
      FROM profile_wallet_links
      WHERE profile_id = ? AND tips_enabled = 1 AND active = 1 AND unlinked_at IS NULL AND visibility = 'public'
      ORDER BY verified_at DESC`)
    .bind(profile.id)
    .all<WalletLinkRow>();
  return {
    enabled: result.results.length > 0,
    handle: profile.handle,
    displayName: profile.display_name,
    options: result.results.map((row) => {
      verifiedTipLink(row);
      return {
      address: row.wallet_address,
      chainId: Number(row.chain_id),
      network: row.network,
      symbol: getHubEvmNetworkByChainId(Number(row.chain_id)).chain.nativeCurrency.symbol,
      minimumAmount: storedTipAmount(row.minimum_tip_wei),
    }; }),
  };
}

export async function confirmWalletTip(input: {
  request: Request;
  database: D1Database;
  recipientHandle: unknown;
  txHash: unknown;
  chainId: unknown;
  articleId?: unknown;
}) {
  const sender = await requireHubSessionProfile(input.request, input.database);
  return confirmWalletTipForViewer({ ...input, profile: sender });
}

export async function confirmWalletTipForViewer(input: {
  request: Request;
  database: D1Database;
  recipientHandle: unknown;
  txHash: unknown;
  chainId: unknown;
  articleId?: unknown;
  profile: { id: string };
}) {
  const sender = input.profile;
  /* 記事からの投げ銭なら記事IDを台帳に残す。形が不正なら無視する（送金済みの確認を落とさない）。 */
  const articleId = typeof input.articleId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input.articleId)
    ? input.articleId : null;
  const recipientHandle = normalizeHandle(input.recipientHandle);
  const txHash = normalizeHash(input.txHash);
  const requestedChainId = Number(input.chainId);
  if (!Number.isSafeInteger(requestedChainId) || requestedChainId <= 0) {
    throw new WalletTipInputError("受取トークンが正しくありません。");
  }

  const recipient = await input.database.prepare(`SELECT p.id AS profile_id,
      p.handle, l.id, l.wallet_address, l.chain_id, l.network, l.tips_enabled, l.minimum_tip_wei, l.visibility, l.verified_at
      FROM profiles p
      JOIN profile_wallet_links l ON l.profile_id = p.id
      WHERE p.handle = ? AND l.tips_enabled = 1 AND l.chain_id = ?
        AND l.active = 1 AND l.unlinked_at IS NULL AND l.visibility = 'public'
      ORDER BY l.verified_at DESC
      LIMIT 1`)
    .bind(recipientHandle, requestedChainId)
    .first<WalletLinkRow & { handle: string }>();
  if (!recipient) {
    throw new WalletTipPermissionError("受取人は投げ銭を有効にしていません。");
  }
  verifiedTipLink(recipient);
  if (recipient.profile_id === sender.id) {
    throw new WalletTipPermissionError("自分自身へ投げ銭はできません。");
  }

  const existing = await input.database.prepare(`SELECT id, sender_profile_id,
      recipient_profile_id, amount_wei, asset_symbol
      FROM wallet_tip_transactions WHERE tx_hash = ? LIMIT 1`)
    .bind(txHash)
    .first<{
      id: string;
      sender_profile_id: string;
      recipient_profile_id: string;
      amount_wei: string;
      asset_symbol: string;
    }>();
  if (existing) {
    if (
      existing.sender_profile_id !== sender.id ||
      existing.recipient_profile_id !== recipient.profile_id
    ) {
      throw new WalletTipVerificationError(
        "このトランザクションはすでに別の投げ銭として登録されています。",
      );
    }
    return {
      id: existing.id,
      txHash,
      amount: formatEther(BigInt(existing.amount_wei)),
      symbol: existing.asset_symbol,
      confirmed: true,
    };
  }

  const chainId = Number(recipient.chain_id);
  const network = getHubEvmNetworkByChainId(chainId);
  const client = createHubPublicClient(chainId);
  let transaction;
  let receipt;
  try {
    [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);
  } catch {
    throw new WalletTipPendingError(
      "トランザクションの承認待ちです。しばらくしてから再確認してください。",
    );
  }
  if (receipt.status !== "success") {
    throw new WalletTipVerificationError("失敗したトランザクションです。");
  }
  if (
    !transaction.to ||
    transaction.to.toLocaleLowerCase("en") !==
      recipient.wallet_address.toLocaleLowerCase("en") ||
    transaction.value <= 0n ||
    transaction.value < BigInt(recipient.minimum_tip_wei || "0") ||
    transaction.chainId !== undefined && transaction.chainId !== chainId ||
    transaction.input !== "0x"
  ) {
    throw new WalletTipVerificationError(
      "受取先または送金内容が投げ銭設定と一致しません。",
    );
  }
  const senderWallet = await input.database.prepare(`SELECT profile_id, id, verified_at,chain_id,tips_enabled,minimum_tip_wei,visibility
      FROM profile_wallet_links WHERE wallet_address = ? AND active = 1 AND unlinked_at IS NULL LIMIT 1`)
    .bind(transaction.from)
    .first<WalletLinkRow>();
  if (!senderWallet || senderWallet.profile_id !== sender.id) {
    throw new WalletTipPermissionError(
      "送信元ウォレットが現在のHubアカウントに紐づいていません。",
    );
  }
  verifiedTipLink(senderWallet);

  const now = new Date().toISOString();
  const id = `wallet-tip-${crypto.randomUUID()}`;
  const symbol = network.chain.nativeCurrency.symbol;
  const results = await input.database.batch([
    input.database.prepare(`INSERT INTO wallet_tip_transactions
        (id, tx_hash, chain_id, network, asset_symbol, amount_wei,
         sender_profile_id, recipient_profile_id, recipient_wallet_link_id,
         confirmed_at, created_at${articleId ? ", article_id" : ""})
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${articleId ? `, (SELECT id FROM hub_user_articles
          WHERE id = ? AND author_profile_id = ? AND status = 'published')` : ""} WHERE EXISTS (
          SELECT 1 FROM profile_wallet_links WHERE id=? AND profile_id=? AND chain_id=?
            AND wallet_address=? AND active=1 AND unlinked_at IS NULL AND visibility='public'
            AND tips_enabled=1 AND verified_at=? AND minimum_tip_wei=?
        ) AND EXISTS (SELECT 1 FROM profile_wallet_links WHERE id=? AND profile_id=? AND chain_id=?
          AND active=1 AND unlinked_at IS NULL AND verified_at=?)`)
      .bind(
        id, txHash, chainId, recipient.network, symbol,
        transaction.value.toString(), sender.id, recipient.profile_id,
        recipient.id, now, now,
        ...(articleId ? [articleId, recipient.profile_id] : []),
        recipient.id, recipient.profile_id, chainId, recipient.wallet_address, recipient.verified_at, recipient.minimum_tip_wei,
        senderWallet.id, sender.id, senderWallet.chain_id, senderWallet.verified_at,
      ),
    input.database.prepare(`INSERT INTO notifications
        (id, receiver_profile_id, actor_profile_id, notification_type,
         target_type, target_id, text, is_read, created_at)
        SELECT ?, ?, ?, 'system', 'system', ?, ?, 0, ?
          WHERE EXISTS (SELECT 1 FROM wallet_tip_transactions WHERE id=?)`)
      .bind(
        `notification-tip-${crypto.randomUUID()}`,
        recipient.profile_id,
        sender.id,
        `/earnings#tip-${id}`,
        `${formatEther(transaction.value)} ${symbol} の投げ銭を受け取りました。`,
        now,
        id,
      ),
  ]);
  if (!results[0]?.meta.changes) throw new WalletTipPermissionError("受取設定またはウォレットの所有確認が変わりました。");
  return {
    id,
    txHash,
    amount: formatEther(transaction.value),
    symbol,
    confirmed: true,
  };
}

export async function listOwnWalletTips(
  request: Request,
  database: D1Database,
) {
  const profile = await requireHubSessionProfile(request, database);
  return listOwnWalletTipsForViewer(profile, database);
}

export async function listOwnWalletTipsForViewer(
  profile: { id: string },
  database: D1Database,
) {
  const result = await database.prepare(`SELECT id, tx_hash, chain_id, network,
      asset_symbol, amount_wei, sender_profile_id, recipient_profile_id,
      confirmed_at
      FROM wallet_tip_transactions
      WHERE sender_profile_id = ? OR recipient_profile_id = ?
      ORDER BY confirmed_at DESC
      LIMIT 100`)
    .bind(profile.id, profile.id)
    .all<{
      id: string; tx_hash: string; chain_id: number; network: string;
      asset_symbol: string; amount_wei: string; sender_profile_id: string;
      recipient_profile_id: string; confirmed_at: string;
    }>();
  return {
    tips: result.results.map((row) => {
      const network = getHubEvmNetworkByChainId(Number(row.chain_id));
      const explorer = network.chain.blockExplorers?.default.url;
      return {
        id: row.id,
        direction: row.recipient_profile_id === profile.id ? "received" : "sent",
        amount: formatEther(BigInt(row.amount_wei)),
        symbol: row.asset_symbol,
        network: row.network,
        txHash: row.tx_hash,
        explorerUrl: explorer ? `${explorer}/tx/${row.tx_hash}` : null,
        confirmedAt: row.confirmed_at,
      };
    }),
  };
}
