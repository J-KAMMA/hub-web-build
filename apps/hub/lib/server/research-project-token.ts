import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { decodeFunctionResult, encodeFunctionData, getAddress } from "viem";

import { ACCESS_GATE_CHAIN_IDS, ACCESS_GATE_MAX_ACQUISITION_URL_LENGTH, type AccessGate, type AccessGateConditionKind } from "@/lib/access-gates/types";
import { createAccessGate, getAccessGate } from "@/lib/server/access-gates";
import { parseGohoSaleUrl } from "@/lib/access-gates/token-pass";
import { getGohoTokenPurchaseApi, type GohoTokenPurchaseApi } from "@/lib/gohotoken/api";
import { AVALANCHE_CHAIN_ID, GOHOTOKEN_V3_FACTORY_AVALANCHE, VENDING_V3_SALE_VIEW_ABI } from "@/lib/gohotoken/vending";
import { RPC_TIMEOUT_MS, envRpc } from "@/lib/server/access-gate-verification";
import { gateTokenMetaDeps, readGateTokenMeta, type GateTokenMetaDeps } from "@/lib/server/access-gate-token-meta";

/*
 * 研究プロジェクトに結ぶトークン（docs/architecture/hub-desci-funding-v1.md）。
 * 形（寄付型 / 売り戻しあり / ほか）はチェーンの読み取りだけで決める。クライアントが形を名乗っても使わない。
 * どの読み取りが失敗しても登録しない（fail closed）。Hub は資金を預からず、販売・返金・税は GohoToken が持つ。
 */

export type ResearchTokenForm = "donation" | "sellback" | "other";

export type ResearchProjectToken = {
  projectId: string;
  chainId: number;
  contract: string;
  kind: AccessGateConditionKind;
  saleAddress: string | null;
  form: ResearchTokenForm;
  acquisitionUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResearchTokenFailure =
  | "research_not_found"
  | "research_forbidden"
  | "invalid_input"
  | "unsupported_chain"
  | "not_found"
  | "wrong_kind"
  | "sale_not_purchasable"
  | "unavailable";

export class ResearchTokenError extends Error {
  constructor(readonly code: ResearchTokenFailure) {
    super(code);
    this.name = "ResearchTokenError";
  }
}

export type ClassifiedToken = Pick<ResearchProjectToken, "chainId" | "contract" | "kind" | "saleAddress" | "form" | "acquisitionUrl">;

export type ResearchTokenDeps = {
  api: GohoTokenPurchaseApi;
  /** 読み取り専用の eth_call。失敗したら throw する。 */
  ethCall: (chainId: number, to: `0x${string}`, data: `0x${string}`) => Promise<string>;
  tokenMeta: GateTokenMetaDeps;
};

export function researchTokenDeps(): ResearchTokenDeps {
  return {
    api: getGohoTokenPurchaseApi(),
    tokenMeta: gateTokenMetaDeps(),
    async ethCall(chainId, to, data) {
      const rpc = envRpc(chainId);
      if (typeof rpc === "string") throw new Error(rpc);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
      try {
        const response = await fetch(rpc.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("rpc_status");
        const body = (await response.json()) as { result?: unknown; error?: unknown } | null;
        if (!body || body.error || typeof body.result !== "string") throw new Error("rpc_result");
        return body.result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** flat（curveKind 0）かつ売り戻し 0 のときだけ寄付型。販売ページの名乗りでなく、販売コントラクトの saleView() を読む。 */
async function readSaleForm(
  deps: ResearchTokenDeps,
  sale: { saleAddress: `0x${string}`; tokenAddress: `0x${string}`; paymentToken: `0x${string}` },
): Promise<"donation" | "sellback"> {
  let view: ReturnType<typeof decodeFunctionResult<typeof VENDING_V3_SALE_VIEW_ABI, "saleView">>;
  try {
    const raw = await deps.ethCall(
      AVALANCHE_CHAIN_ID,
      getAddress(sale.saleAddress.toLowerCase()),
      encodeFunctionData({ abi: VENDING_V3_SALE_VIEW_ABI, functionName: "saleView" }),
    );
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error("shape");
    view = decodeFunctionResult({ abi: VENDING_V3_SALE_VIEW_ABI, functionName: "saleView", data: raw as `0x${string}` });
  } catch {
    throw new ResearchTokenError("unavailable");
  }
  if (view.factory.toLowerCase() !== GOHOTOKEN_V3_FACTORY_AVALANCHE.toLowerCase()) throw new ResearchTokenError("sale_not_purchasable");
  if (view.token.toLowerCase() !== sale.tokenAddress.toLowerCase()) throw new ResearchTokenError("unavailable");
  if (view.paymentToken.toLowerCase() !== sale.paymentToken.toLowerCase()) throw new ResearchTokenError("unavailable");
  return Number(view.curveKind) === 0 && Number(view.sellReturnBps) === 0 ? "donation" : "sellback";
}

export function validateAcquisitionUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ResearchTokenError("invalid_input");
  const text = value.trim();
  if (text.length > ACCESS_GATE_MAX_ACQUISITION_URL_LENGTH) throw new ResearchTokenError("invalid_input");
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("bad");
  } catch {
    throw new ResearchTokenError("invalid_input");
  }
  return text;
}

/** 入力は2通り: { saleUrl }（GohoToken の販売ページ）か { chainId, kind, contract, acquisitionUrl? }（ほか）。 */
export async function classifyResearchToken(input: unknown, deps: ResearchTokenDeps): Promise<ClassifiedToken> {
  if (!input || typeof input !== "object") throw new ResearchTokenError("invalid_input");
  const body = input as Record<string, unknown>;
  if (body.saleUrl !== undefined) {
    if (typeof body.saleUrl !== "string") throw new ResearchTokenError("invalid_input");
    const parsed = parseGohoSaleUrl(body.saleUrl);
    if (!parsed.ok) throw new ResearchTokenError(parsed.code === "not_avalanche" ? "unsupported_chain" : "invalid_input");
    const sale = await deps.api.getSale({ chainId: parsed.chainId, saleAddress: parsed.saleAddress }).catch(() => null);
    if (!sale || sale.status !== "ok") {
      if (sale?.status === "unavailable" && sale.reason === "sale_not_purchasable") throw new ResearchTokenError("sale_not_purchasable");
      if (sale?.status === "unavailable" && (sale.reason === "sale_unavailable" || sale.reason === "sale_shape")) throw new ResearchTokenError("not_found");
      throw new ResearchTokenError("unavailable");
    }
    const info = sale.value;
    if (info.chainId !== AVALANCHE_CHAIN_ID) throw new ResearchTokenError("unsupported_chain");
    const form = await readSaleForm(deps, info);
    return {
      chainId: AVALANCHE_CHAIN_ID,
      contract: info.tokenAddress.toLowerCase(),
      kind: "erc20",
      saleAddress: info.saleAddress.toLowerCase(),
      form,
      acquisitionUrl: null,
    };
  }
  const { kind, chainId, contract } = body;
  if (typeof chainId === "number" && !(ACCESS_GATE_CHAIN_IDS as readonly number[]).includes(chainId)) throw new ResearchTokenError("unsupported_chain");
  const acquisitionUrl = validateAcquisitionUrl(body.acquisitionUrl);
  const result = await readGateTokenMeta({ kind, chainId, contract }, deps.tokenMeta).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  if (!result.ok) throw new ResearchTokenError(result.reason);
  return {
    chainId: result.meta.chainId,
    contract: result.meta.contract.toLowerCase(),
    kind: result.meta.kind,
    saleAddress: null,
    form: "other",
    acquisitionUrl,
  };
}

/* ---- D1 ---- */

const select = `SELECT t.project_id projectId,t.chain_id chainId,t.contract,t.kind,t.sale_address saleAddress,t.form,
  t.acquisition_url acquisitionUrl,t.created_at createdAt,t.updated_at updatedAt FROM research_project_tokens t`;

/** 閲覧できるプロジェクト（公開か本人のもの）のトークンだけを返す。 */
export async function getResearchProjectToken(database: D1Database, projectId: string, viewerId?: string | null): Promise<ResearchProjectToken | null> {
  const row = await database
    .prepare(`${select} JOIN research_projects p ON p.id=t.project_id WHERE t.project_id=? AND (p.visibility='public' OR p.owner_profile_id=?)`)
    .bind(projectId, viewerId ?? "")
    .first<ResearchProjectToken>();
  return row ?? null;
}

async function assertOwner(database: D1Database, projectId: string, viewerId: string): Promise<void> {
  const row = await database.prepare("SELECT owner_profile_id ownerProfileId FROM research_projects WHERE id=?").bind(projectId).first<{ ownerProfileId: string }>();
  if (!row) throw new ResearchTokenError("research_not_found");
  if (row.ownerProfileId !== viewerId) throw new ResearchTokenError("research_forbidden");
}

export async function putResearchProjectToken(
  database: D1Database,
  projectId: string,
  viewerId: string,
  input: unknown,
  deps: ResearchTokenDeps,
): Promise<ResearchProjectToken> {
  await assertOwner(database, projectId, viewerId);
  const token = await classifyResearchToken(input, deps);
  const now = new Date().toISOString();
  await database
    .prepare(`INSERT INTO research_project_tokens(project_id,chain_id,contract,kind,sale_address,form,acquisition_url,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET chain_id=excluded.chain_id,contract=excluded.contract,kind=excluded.kind,
        sale_address=excluded.sale_address,form=excluded.form,acquisition_url=excluded.acquisition_url,gate_id=NULL,updated_at=excluded.updated_at`)
    .bind(projectId, token.chainId, token.contract, token.kind, token.saleAddress, token.form, token.acquisitionUrl, now, now)
    .run();
  const saved = await getResearchProjectToken(database, projectId, viewerId);
  if (!saved) throw new ResearchTokenError("unavailable");
  return saved;
}

export async function deleteResearchProjectToken(database: D1Database, projectId: string, viewerId: string): Promise<void> {
  await assertOwner(database, projectId, viewerId);
  await database.prepare("DELETE FROM research_project_tokens WHERE project_id=?").bind(projectId).run();
}

/* ---- 支援者限定ゲート ---- */

export type SupporterGateDeps = {
  tokenMeta: GateTokenMetaDeps;
  getGate: (database: D1Database, gateId: string) => Promise<AccessGate | null>;
  createGate: (database: D1Database, ownerProfileId: string, input: unknown) => Promise<AccessGate>;
};

export function supporterGateDeps(): SupporterGateDeps {
  return { tokenMeta: gateTokenMetaDeps(), getGate: getAccessGate, createGate: createAccessGate };
}

/**
 * 登録済みトークンを1単位以上持つ人だけが見られる門を返す（あれば再利用、なければ作る）。
 * 桁数はサーバーがチェーンから読む。erc1155 は研究側にトークンIDが無いので作らない。読み取りに失敗したら作らない。
 */
export async function ensureResearchSupporterGate(
  database: D1Database,
  projectId: string,
  viewerId: string,
  deps: SupporterGateDeps = supporterGateDeps(),
): Promise<AccessGate> {
  await assertOwner(database, projectId, viewerId);
  const row = await database
    .prepare("SELECT t.chain_id chainId,t.contract,t.kind,t.gate_id gateId,p.title FROM research_project_tokens t JOIN research_projects p ON p.id=t.project_id WHERE t.project_id=?")
    .bind(projectId)
    .first<{ chainId: number; contract: string; kind: AccessGateConditionKind; gateId: string | null; title: string }>();
  if (!row) throw new ResearchTokenError("not_found");
  if (row.gateId) {
    const existing = await deps.getGate(database, row.gateId).catch(() => null);
    if (existing && existing.ownerProfileId === viewerId) return existing;
  }
  if (row.kind === "erc1155") throw new ResearchTokenError("invalid_input");
  let minRaw = "1";
  let decimals: number | null = null;
  if (row.kind === "erc20") {
    const meta = await readGateTokenMeta({ kind: row.kind, chainId: row.chainId, contract: row.contract }, deps.tokenMeta).catch(() => null);
    if (!meta || !meta.ok || meta.meta.decimals === null || !Number.isInteger(meta.meta.decimals) || meta.meta.decimals < 0 || meta.meta.decimals > 77) {
      throw new ResearchTokenError("unavailable");
    }
    decimals = meta.meta.decimals;
    minRaw = (BigInt(10) ** BigInt(decimals)).toString();
  }
  try {
    const gate = await deps.createGate(database, viewerId, {
      match: "any",
      description: `研究「${row.title}」の支援者`.slice(0, 280),
      conditions: [{ kind: row.kind, chainId: row.chainId, contract: row.contract, minRaw, decimals }],
    });
    await database.prepare("UPDATE research_project_tokens SET gate_id=? WHERE project_id=?").bind(gate.id, projectId).run();
    return gate;
  } catch {
    throw new ResearchTokenError("unavailable");
  }
}
