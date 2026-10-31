import "server-only";

import { decodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";

import { ACCESS_GATE_CHAIN_IDS, type AccessGateConditionKind } from "@/lib/access-gates/types";
import { RPC_TIMEOUT_MS, envRpc } from "@/lib/server/access-gate-verification";

/*
 * 閲覧条件に使うトークンの名前・記号・桁数を、門の確認と同じ許可済みチェーン・同じRPC設定で読む（読み取りのみ）。
 * 新しいチェーンもプロバイダも足さない。読めない・形が違うときは必ず失敗で返し、何も推測しない。
 */

export type GateTokenMeta = {
  kind: AccessGateConditionKind;
  chainId: number;
  contract: string;
  name: string | null;
  symbol: string | null;
  /** erc20 のみ */
  decimals: number | null;
};

export type GateTokenMetaFailure = "invalid_input" | "unsupported_chain" | "unavailable" | "not_found" | "wrong_kind";

export type GateTokenMetaResult = { ok: true; meta: GateTokenMeta } | { ok: false; reason: GateTokenMetaFailure };

export type GateTokenMetaDeps = {
  resolveRpc: (chainId: number) => { url: string } | "unsupported_chain" | "rpc_not_configured";
  fetch: typeof fetch;
};

const abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function supportsInterface(bytes4) view returns (bool)",
]);

const ERC721_INTERFACE = "0x80ac58cd";
const ERC1155_INTERFACE = "0xd9b67a26";

class Transport extends Error {}

/** null = コールが失敗（revert・コード無し）。Transport = 通信や形の異常。 */
async function ethCall(deps: GateTokenMetaDeps, url: string, to: string, data: Hex): Promise<Hex | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Transport();
    const body = (await response.json()) as { result?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (!body || typeof body !== "object") throw new Transport();
    if (body.error) {
      const message = typeof body.error.message === "string" ? body.error.message.toLowerCase() : "";
      if (body.error.code === 3 || message.includes("revert")) return null;
      throw new Transport();
    }
    if (typeof body.result !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(body.result)) throw new Transport();
    return body.result === "0x" ? null : (body.result as Hex);
  } catch (error) {
    if (error instanceof Transport) throw error;
    throw new Transport();
  } finally {
    clearTimeout(timer);
  }
}

async function readString(deps: GateTokenMetaDeps, url: string, to: string, functionName: "name" | "symbol"): Promise<string | null> {
  const result = await ethCall(deps, url, to, encodeFunctionData({ abi, functionName }));
  if (!result) return null;
  try {
    const [value] = decodeAbiParameters([{ type: "string" }], result);
    const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return text && text.length <= 80 ? text : null;
  } catch {
    return null;
  }
}

async function supports(deps: GateTokenMetaDeps, url: string, to: string, id: Hex): Promise<boolean> {
  const result = await ethCall(deps, url, to, encodeFunctionData({ abi, functionName: "supportsInterface", args: [id] }));
  if (!result) return false;
  try {
    const [value] = decodeAbiParameters([{ type: "bool" }], result);
    return value === true;
  } catch {
    return false;
  }
}

export async function readGateTokenMeta(
  input: { kind: unknown; chainId: unknown; contract: unknown },
  deps: GateTokenMetaDeps,
): Promise<GateTokenMetaResult> {
  const { kind, chainId, contract } = input;
  if (kind !== "erc20" && kind !== "erc721" && kind !== "erc1155") return { ok: false, reason: "invalid_input" };
  if (typeof chainId !== "number" || !(ACCESS_GATE_CHAIN_IDS as readonly number[]).includes(chainId)) {
    return { ok: false, reason: "unsupported_chain" };
  }
  if (typeof contract !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(contract.trim())) return { ok: false, reason: "invalid_input" };
  const address = contract.trim().toLowerCase();
  const rpc = deps.resolveRpc(chainId);
  if (rpc === "unsupported_chain") return { ok: false, reason: "unsupported_chain" };
  if (rpc === "rpc_not_configured") return { ok: false, reason: "unavailable" };
  try {
    if (kind === "erc20") {
      const raw = await ethCall(deps, rpc.url, address, encodeFunctionData({ abi, functionName: "decimals" }));
      if (!raw) return { ok: false, reason: "not_found" };
      let decimals: number;
      try {
        decimals = Number(decodeAbiParameters([{ type: "uint8" }], raw)[0]);
      } catch {
        return { ok: false, reason: "not_found" };
      }
      if (!Number.isInteger(decimals) || decimals > 36) return { ok: false, reason: "not_found" };
      const [name, symbol] = await Promise.all([
        readString(deps, rpc.url, address, "name"),
        readString(deps, rpc.url, address, "symbol"),
      ]);
      return { ok: true, meta: { kind, chainId, contract: address, name, symbol, decimals } };
    }
    const id = kind === "erc721" ? ERC721_INTERFACE : ERC1155_INTERFACE;
    if (!(await supports(deps, rpc.url, address, id))) return { ok: false, reason: "wrong_kind" };
    const [name, symbol] = await Promise.all([
      readString(deps, rpc.url, address, "name"),
      readString(deps, rpc.url, address, "symbol"),
    ]);
    return { ok: true, meta: { kind, chainId, contract: address, name, symbol, decimals: null } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function gateTokenMetaDeps(): GateTokenMetaDeps {
  return { resolveRpc: envRpc, fetch: (input, init) => fetch(input, init) };
}
