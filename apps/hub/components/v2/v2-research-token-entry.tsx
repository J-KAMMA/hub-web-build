"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ACCESS_GATE_KIND_LABELS, chainOptions, readApiError } from "@/components/v2/v2-access-gate-shared";
import { GohoTokenPurchasePanel } from "@/components/v2/v2-gate-gohotoken-purchase";
import { ACCESS_GATE_CONDITION_KINDS, type AccessGateConditionKind } from "@/lib/access-gates/types";
import type { ResearchProjectToken } from "@/lib/server/research-project-token";
import { AVALANCHE_CHAIN_ID, GOHO_TOKEN_DECIMALS } from "@/lib/gohotoken/vending";

import "./v2-access-gates.css";

/* 研究プロジェクトのトークン入口。形はサーバーがチェーンから決めたものを表示するだけ。利回り・予想・値動き・比較は出さない。 */

export const RESEARCH_TOKEN_LABELS = {
  donation: "支援者の証",
  sellback: "売り戻し額は払った額を上回ることも下回ることもあります。",
  other: "保有者向け",
  seller: "販売元: GohoToken",
  leaving: "外部サイトを開く（Hubの外へ移動します）",
} as const;

const CHAINS = chainOptions();

export function V2ResearchTokenEntry({ projectId, token, canEdit }: { projectId: string; token: ResearchProjectToken | null; canEdit: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"goho" | "other">("goho");
  const [saleUrl, setSaleUrl] = useState("");
  const [chainId, setChainId] = useState<number>(CHAINS[0]?.chainId ?? 1);
  const [kind, setKind] = useState<AccessGateConditionKind>("erc20");
  const [contract, setContract] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token && !canEdit) return null;

  async function send(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/token`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await readApiError(response, "登録できませんでした。"));
        return;
      }
      router.refresh();
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function writeFor(path: "/v2/articles/new" | "/v2/bbs") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/token/gate`, { method: "POST" });
      if (!response.ok) {
        setError(await readApiError(response, "鍵を用意できませんでした。"));
        return;
      }
      const payload = (await response.json().catch(() => null)) as { gateId?: unknown } | null;
      if (typeof payload?.gateId !== "string") {
        setError("鍵を用意できませんでした。");
        return;
      }
      router.push(`${path}?gate=${encodeURIComponent(payload.gateId)}`);
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send("PUT", mode === "goho" ? { saleUrl } : { chainId, kind, contract: contract.trim(), acquisitionUrl: link.trim() || undefined });
  }

  return (
    <section className="v2-gate-card" aria-labelledby="research-token-title" id="token">
      <h2 className="v2-gate-card__title" id="research-token-title">研究の支援</h2>
      {token ? (
        token.form === "other" ? (
          <>
            <p className="v2-gate-card__state">{RESEARCH_TOKEN_LABELS.other}</p>
            {token.acquisitionUrl ? (
              <p className="v2-gate-card__acquire">
                <a href={token.acquisitionUrl} target="_blank" rel="noopener noreferrer nofollow ugc">{RESEARCH_TOKEN_LABELS.leaving}</a>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="v2-gate-card__state">{token.form === "donation" ? RESEARCH_TOKEN_LABELS.donation : RESEARCH_TOKEN_LABELS.sellback}</p>
            <p className="v2-gate-card__state">{RESEARCH_TOKEN_LABELS.seller}</p>
            {token.saleAddress ? (
              <GohoTokenPurchasePanel
                content={{
                  title: "",
                  chainId: AVALANCHE_CHAIN_ID,
                  saleAddress: token.saleAddress,
                  tokenAddress: token.contract,
                  requiredBalance: "1",
                  requiredBalanceDecimals: GOHO_TOKEN_DECIMALS,
                }}
                showGateNote={false}
                // 研究の閲覧は購入で変わらない。ここでは何も許可しない。
                recheckAccess={async () => true}
              />
            ) : null}
          </>
        )
      ) : null}
      {canEdit && token ? (
        <p className="v2-gate__actions">
          <button type="button" className="v2-gate__button" disabled={busy} onClick={() => void writeFor("/v2/articles/new")}>支援者向けの記事を書く</button>
          <button type="button" className="v2-gate__button" disabled={busy} onClick={() => void writeFor("/v2/bbs")}>支援者向けのスレッドを立てる</button>
        </p>
      ) : null}
      {canEdit ? (
        <details className="v2-gate-card__details" open={!token}>
        <summary>{token ? "トークンを変える" : "トークンを登録する"}</summary>
        <form className="v2-gate__form" onSubmit={submit}>
          <label className="v2-gate__field">
            トークン
            <select value={mode} onChange={(event) => setMode(event.target.value as "goho" | "other")} disabled={busy}>
              <option value="goho">GohoToken</option>
              <option value="other">ほかのトークン</option>
            </select>
          </label>
          {mode === "goho" ? (
            <label className="v2-gate__field">
              販売ページのURL
              <input type="url" value={saleUrl} onChange={(event) => setSaleUrl(event.target.value)} placeholder="https://gohotoken.com/token/43114/0x…" required disabled={busy} />
            </label>
          ) : (
            <>
              <label className="v2-gate__field">
                チェーン
                <select value={chainId} onChange={(event) => setChainId(Number(event.target.value))} disabled={busy}>
                  {CHAINS.map((chain) => <option key={chain.chainId} value={chain.chainId}>{chain.name}</option>)}
                </select>
              </label>
              <label className="v2-gate__field">
                種類
                <select value={kind} onChange={(event) => setKind(event.target.value as AccessGateConditionKind)} disabled={busy}>
                  {ACCESS_GATE_CONDITION_KINDS.map((value) => <option key={value} value={value}>{ACCESS_GATE_KIND_LABELS[value]}</option>)}
                </select>
              </label>
              <label className="v2-gate__field">
                コントラクト
                <input value={contract} onChange={(event) => setContract(event.target.value)} placeholder="0x…" required disabled={busy} />
              </label>
              <label className="v2-gate__field">
                入手先リンク（https・任意）
                <input type="url" value={link} onChange={(event) => setLink(event.target.value)} disabled={busy} />
              </label>
            </>
          )}
          <p className="v2-gate__actions">
            <button type="submit" className="v2-gate__button v2-gate__button--primary" disabled={busy}>{token ? "置き換える" : "登録する"}</button>
            {token ? <button type="button" className="v2-gate__button v2-gate__button--danger" disabled={busy} onClick={() => void send("DELETE")}>外す</button> : null}
          </p>
          {error ? <p className="v2-note" role="alert">{error}</p> : null}
        </form>
        </details>
      ) : null}
    </section>
  );
}
