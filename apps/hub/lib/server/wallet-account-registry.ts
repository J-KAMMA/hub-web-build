import type { D1Database } from "@cloudflare/workers-types";

import { normalizeEvmAddressForStorage } from "@/lib/multichain-wallet";

/** The address is already verified by another Hub profile, or is not an EVM address. */
export class WalletAlreadyLinkedError extends Error {}

export type VerifiedEvmWalletInput = {
  profileId: string;
  address: string;
  chainId: number;
  network: string;
  verifiedAt: string;
};

/**
 * Records a signature-verified EVM wallet for a profile.
 *
 * Only VERIFIED rows claim an address (migration 0306): a watch-only row of another profile never blocks the
 * link, and the profile's own watch-only row is upgraded in place. Only EVM addresses may reach this path,
 * because `profile_wallet_links.wallet_address` is COLLATE NOCASE and the address is lowercased here; base58
 * (Solana, Bitcoin) addresses are case-sensitive and must never be folded.
 */
export async function registerVerifiedEvmWallet(database: D1Database, input: VerifiedEvmWalletInput): Promise<{ accountId: string }> {
  const lower = normalizeEvmAddressForStorage(input.address);
  if (!lower) throw new WalletAlreadyLinkedError("not_an_evm_address");

  const existingLink = await database.prepare("SELECT profile_id FROM profile_wallet_links WHERE wallet_address = ? LIMIT 1")
    .bind(input.address).first<{ profile_id: string }>();
  if (existingLink && existingLink.profile_id !== input.profileId) throw new WalletAlreadyLinkedError("linked_elsewhere");

  const verified = await database.prepare(
    "SELECT id, profile_id FROM profile_wallet_accounts WHERE namespace = 'eip155' AND normalized_address = ? AND verification_status = 'verified' LIMIT 1",
  ).bind(lower).first<{ id: string; profile_id: string }>();
  if (verified && verified.profile_id !== input.profileId) throw new WalletAlreadyLinkedError("linked_elsewhere");

  const own = verified ?? await database.prepare(
    "SELECT id, profile_id FROM profile_wallet_accounts WHERE namespace = 'eip155' AND normalized_address = ? AND profile_id = ? LIMIT 1",
  ).bind(lower, input.profileId).first<{ id: string; profile_id: string }>();

  const accountId = own?.id ?? `wallet-account-${crypto.randomUUID()}`;
  const at = input.verifiedAt;
  await database.batch([
    database.prepare(`INSERT INTO profile_wallet_links
      (id, profile_id, chain_id, network, wallet_address, visibility, verified_at, last_balance_refresh_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'private', ?, ?, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET chain_id=excluded.chain_id, network=excluded.network, verified_at=excluded.verified_at
      WHERE profile_id=excluded.profile_id`)
      .bind(`wallet-link-${crypto.randomUUID()}`, input.profileId, input.chainId, input.network, input.address, at, at, at),
    own
      ? database.prepare(`UPDATE profile_wallet_accounts SET display_address=?, address_kind='evm', verification_status='verified',
          verification_method='eip712_profile_link', verified_at=?, updated_at=? WHERE id=? AND profile_id=?`)
        .bind(input.address, at, at, accountId, input.profileId)
      : database.prepare(`INSERT INTO profile_wallet_accounts
        (id, profile_id, namespace, normalized_address, display_address, address_kind, verification_status, verification_method, verified_at, visibility, created_at, updated_at)
        VALUES (?, ?, 'eip155', ?, ?, 'evm', 'verified', 'eip712_profile_link', ?, 'private', ?, ?)`)
        .bind(accountId, input.profileId, lower, input.address, at, at, at),
    database.prepare(`INSERT INTO wallet_account_networks (wallet_account_id, network_reference, enabled, created_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(wallet_account_id, network_reference) DO UPDATE SET enabled=1`)
      .bind(accountId, String(input.chainId), at),
  ]);
  return { accountId };
}
