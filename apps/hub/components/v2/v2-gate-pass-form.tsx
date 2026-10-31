"use client";

import { useState, type FormEvent } from "react";

import type { AccessGate, AccessGateConditionKind } from "@/lib/access-gates/types";
import {
  buildGohoPassInput,
  buildOtherPassInput,
  fetchTokenMeta,
  resolveGohoPass,
  tokenDisplayName,
  type GohoPass,
  type OtherTokenMeta,
} from "@/lib/access-gates/token-pass";
import { ACCESS_GATE_KIND_LABELS, chainOptions, readApiError } from "@/components/v2/v2-access-gate-shared";

import "./v2-access-gates.css";

/*
 * 「トークンを鍵にする」かんたん設定。技術的な入力（チェーン・規格・コントラクト）を前に出さない。
 *  (a) gohotokenで作ったトークン: 販売ページのURLだけ。ハブ内の購入が出るのはこの形だけ（販売元 GohoToken）。
 *  (b) ほかのトークン: チェーンとアドレスを入れると、名前などをハブが読み取って見せる。入手先リンクは任意で1つ。
 * 確かめに失敗したら保存できない。保存は既存の閲覧条件API（/api/access-gates）にそのまま渡す。
 */

type Mode = "goho" | "other";

type Props = {
  onSaved: (gate: AccessGate) => void;
  onAdvanced: () => void;
  onCancel: () => void;
  /** 保存ボタンの下に出す補足（任意） */
  advancedLabel?: string;
};

const CHAIN_OPTIONS = chainOptions();
const FIRST_CHAIN = CHAIN_OPTIONS[0]?.chainId ?? 1;

export function V2GatePassForm({ onSaved, onAdvanced, onCancel, advancedLabel = "詳細設定" }: Props) {
  const [mode, setMode] = useState<Mode>("goho");
  const [saleUrl, setSaleUrl] = useState("");
  const [pass, setPass] = useState<GohoPass | null>(null);
  const [kind, setKind] = useState<AccessGateConditionKind>("erc20");
  const [chainId, setChainId] = useState<number>(FIRST_CHAIN);
  const [contract, setContract] = useState("");
  const [meta, setMeta] = useState<OtherTokenMeta | null>(null);
  const [tokenId, setTokenId] = useState("");
  const [link, setLink] = useState("");
  const [amount, setAmount] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetResolved = () => {
    setPass(null);
    setMeta(null);
    setError(null);
  };

  const resolveGoho = async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    setPass(null);
    const result = await resolveGohoPass(saleUrl);
    setChecking(false);
    if (!result.ok) return setError(result.message);
    setPass(result.pass);
  };

  const resolveOther = async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    setMeta(null);
    const result = await fetchTokenMeta({ kind, chainId, contract });
    setChecking(false);
    if (!result.ok) return setError(result.message);
    setMeta(result.meta);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    // 確かめていない・確かめに失敗した状態では何も送らない。
    const built =
      mode === "goho"
        ? pass
          ? buildGohoPassInput(pass, amount)
          : null
        : meta
          ? buildOtherPassInput(meta, { amount, tokenId, link })
          : null;
    if (!built) return setError(mode === "goho" ? "先に販売ページを確かめてください。" : "先にトークンを確かめてください。");
    if (!built.ok) return setError(built.message);
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/access-gates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.input),
      });
      if (!response.ok) return setError(await readApiError(response, "閲覧条件を保存できませんでした。"));
      const payload = (await response.json().catch(() => null)) as { gate?: AccessGate } | null;
      if (!payload?.gate) return setError("閲覧条件を保存できませんでした。");
      onSaved(payload.gate);
    } catch {
      setError("通信できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  const resolved = mode === "goho" ? pass !== null : meta !== null;
  const showTokenId = mode === "other" && meta !== null && (meta.kind === "erc1155" || meta.kind === "erc721");

  return (
    <form className="v2-gate__form" onSubmit={submit} aria-label="トークンを鍵にする">
      <fieldset className="v2-gate__condition">
        <legend>トークンを鍵にする</legend>
        <label className="v2-gate__field">
          <span>どのトークンを使いますか</span>
          <select
            aria-label="トークンの選び方"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value === "other" ? "other" : "goho");
              resetResolved();
            }}
          >
            <option value="goho">gohotokenで作ったトークン</option>
            <option value="other">ほかのトークン</option>
          </select>
        </label>

        {mode === "goho" ? (
          <>
            <label className="v2-gate__field">
              <span>gohotokenの販売ページのURL</span>
              <input
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://gohotoken.com/token/43114/0x…"
                aria-label="gohotokenの販売ページのURL"
                value={saleUrl}
                onChange={(event) => {
                  setSaleUrl(event.target.value);
                  resetResolved();
                }}
              />
            </label>
            <button type="button" className="v2-gate__button" onClick={() => void resolveGoho()} disabled={checking}>
              {checking ? "確かめています…" : "販売ページを確かめる"}
            </button>
            {pass ? (
              <dl className="v2-gate__resolved" aria-label="確かめたトークン">
                <dt>トークン名</dt>
                <dd>{pass.tokenName || "（名前なし）"}</dd>
                <dt>記号</dt>
                <dd>{pass.tokenSymbol ?? "—"}</dd>
                <dt>販売ページ</dt>
                <dd><a className="v2-gate__link" href={pass.saleUrl} target="_blank" rel="noopener noreferrer nofollow ugc">{pass.saleUrl}</a></dd>
              </dl>
            ) : null}
            <p className="v2-note">閲覧する人がこのトークンを持っていないときは、ハブの中でgohotokenからこのトークンを買えます（販売元はgohotokenです）。</p>
          </>
        ) : (
          <>
            <label className="v2-gate__field">
              <span>種類</span>
              <select
                aria-label="トークンの種類"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as AccessGateConditionKind);
                  resetResolved();
                }}
              >
                <option value="erc20">{ACCESS_GATE_KIND_LABELS.erc20}</option>
                <option value="erc721">{ACCESS_GATE_KIND_LABELS.erc721}</option>
                <option value="erc1155">{ACCESS_GATE_KIND_LABELS.erc1155}</option>
              </select>
            </label>
            <label className="v2-gate__field">
              <span>チェーン</span>
              <select
                aria-label="チェーン"
                value={chainId}
                onChange={(event) => {
                  setChainId(Number(event.target.value));
                  resetResolved();
                }}
              >
                {CHAIN_OPTIONS.map((option) => <option key={option.chainId} value={option.chainId}>{option.name}</option>)}
              </select>
            </label>
            <label className="v2-gate__field">
              <span>コントラクトアドレス</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x…"
                aria-label="コントラクトアドレス"
                value={contract}
                onChange={(event) => {
                  setContract(event.target.value);
                  resetResolved();
                }}
              />
            </label>
            <button type="button" className="v2-gate__button" onClick={() => void resolveOther()} disabled={checking}>
              {checking ? "確かめています…" : "トークンを確かめる"}
            </button>
            {meta ? (
              <dl className="v2-gate__resolved" aria-label="確かめたトークン">
                <dt>トークン名</dt>
                <dd>{tokenDisplayName(meta)}</dd>
                <dt>記号</dt>
                <dd>{meta.symbol ?? "—"}</dd>
                {meta.decimals !== null ? (
                  <>
                    <dt>小数桁数</dt>
                    <dd>{meta.decimals}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </>
        )}

        {resolved ? (
          <>
            <label className="v2-gate__field">
              <span>必要な枚数</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label="必要な枚数"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            {showTokenId ? (
              <label className="v2-gate__field">
                <span>{meta?.kind === "erc1155" ? "トークンID（1つ）" : "トークンID（省略可。空ならコレクション全体）"}</span>
                <input
                  type="text"
                  autoComplete="off"
                  aria-label="トークンID"
                  value={tokenId}
                  onChange={(event) => setTokenId(event.target.value)}
                />
              </label>
            ) : null}
            {mode === "other" ? (
              <>
                <label className="v2-gate__field">
                  <span>入手先リンク（省略可。httpsのURL1つ）</span>
                  <input
                    type="url"
                    autoComplete="off"
                    placeholder="https://"
                    aria-label="入手先リンク"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                  />
                </label>
                <p className="v2-note">入手先リンクは外部のページとして表示され、ハブの外へ移動します。ハブの中での購入はできません。</p>
              </>
            ) : null}
          </>
        ) : null}
      </fieldset>

      {error ? <p className="v2-error" role="alert">{error}</p> : null}
      <div className="v2-gate__actions">
        <button type="button" className="v2-gate__button" onClick={onCancel} disabled={saving}>やめる</button>
        <button type="button" className="v2-gate__button" onClick={onAdvanced} disabled={saving}>{advancedLabel}</button>
        <button type="submit" className="v2-gate__button v2-gate__button--primary" disabled={saving || !resolved}>
          {saving ? "保存しています…" : "保存する"}
        </button>
      </div>
    </form>
  );
}
