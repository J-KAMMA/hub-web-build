// apps/wallet-extension/src/smart-account.js の移植。
// パスキー公開鍵からカウンターファクチュアル・スマートアカウントアドレスを導出。

import { rpcConsensusRequest } from "./rpc-client";
import type { WalletFetcher } from "./json-rpc";

const GET_ADDRESS_SELECTOR = "dc55776f";

function word(value: string): string {
  const normalized = value.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length > 64) throw new Error("invalid_abi_value");
  return normalized.padStart(64, "0");
}

function address(value: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error("invalid_factory_address");
  return value.toLowerCase();
}

export function encodeFactoryGetAddress(qx: string, qy: string, salt = 0n): string {
  return `0x${GET_ADDRESS_SELECTOR}${word(qx)}${word(qy)}${word(`0x${BigInt(salt).toString(16)}`)}`;
}

export async function resolveSmartAccount({ rpcUrls, chainId, factoryAddress, qx, qy, salt = 0n }: {
  rpcUrls: string[];
  chainId: string | number | bigint;
  factoryAddress: string;
  qx: string;
  qy: string;
  salt?: bigint;
}, fetcher: WalletFetcher = fetch as WalletFetcher): Promise<string> {
  const factory = address(factoryAddress);
  const normalize = (value: unknown) => String(value).toLowerCase();
  const code = (await rpcConsensusRequest(rpcUrls, chainId, "eth_getCode", [factory, "latest"], fetcher, { normalize })).normalized;
  if (code === "0x" || code === "0x0") throw new Error("factory_not_deployed");
  const result = (await rpcConsensusRequest(rpcUrls, chainId, "eth_call", [{ to: factory, data: encodeFactoryGetAddress(qx, qy, salt) }, "latest"], fetcher, { normalize })).normalized;
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error("invalid_factory_response");
  const account = `0x${result.slice(-40)}`.toLowerCase();
  if (/^0x0{40}$/.test(account)) throw new Error("invalid_smart_account");
  return account;
}
