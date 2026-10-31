"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  ACCESS_GATE_CONDITION_KINDS,
  ACCESS_GATE_MAX_CONDITIONS,
  ACCESS_GATE_SOLANA_CONDITION_KINDS,
  isSolanaGateKind,
  ACCESS_GATE_MAX_DESCRIPTION_LENGTH,
  type AccessGate,
  type AccessGateConditionKind,
} from "@/lib/access-gates/types";
import type { AccessGateUsage } from "@/lib/server/access-gates";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Empty } from "@/components/v2/v2-empty";
import { Button } from "@/components/v2/ui/button";
import { V2GatePassForm } from "@/components/v2/v2-gate-pass-form";
import {
  ACCESS_GATE_KIND_LABELS,
  chainOptions,
  emptyCondition,
  emptyGateDraft,
  matchLabel,
  rawToHuman,
  readApiError,
  SOLANA_GATE_NETWORK_OPTIONS,
  summarizeCondition,
  validateGateDraft,
  type ConditionDraft,
  type GateDraft,
} from "@/components/v2/v2-access-gate-shared";

import "./v2-access-gates.css";

/*
 * 閲覧条件（門）の作成・編集・一覧・削除。docs/hub-token-gates/DESIGN.md の画面。
 * 検証の正本はサーバー。ここは入力の早い段階で間違いを知らせる。
 * 手に入れ方のリンクは作成者が1つだけ置ける。ハブは推奨の形で並べない。
 */

function draftFromGate(gate: AccessGate): GateDraft {
  return {
    match: gate.match,
    description: gate.description,
    acquisitionUrl: gate.acquisitionUrl ?? "",
    conditions: gate.conditions.map((condition) => ({
      ...emptyCondition(),
      kind: condition.kind,
      chainId: condition.chainId || emptyCondition().chainId,
      chainRef: condition.chainRef,
      contract: condition.contract,
      amount: condition.kind === "erc20" || condition.kind === "spl" ? rawToHuman(condition.minRaw, condition.decimals)
        : condition.kind === "sol_native" ? rawToHuman(condition.minRaw, 9)
        : condition.kind === "erc1155" ? condition.minRaw : "",
      decimals: String(condition.decimals ?? 18),
      tokenIds: condition.tokenIds.join(", "),
    })),
  };
}

/** 付け先の数だけを言う。開いた人や人数は表示しない。 */
function usageLabel(usage: AccessGateUsage | undefined): string {
  if (!usage) return "未使用";
  const parts = [
    usage.articles ? `記事 ${usage.articles}` : "",
    usage.posts ? `投稿 ${usage.posts}` : "",
    usage.other ? `その他 ${usage.other}` : "",
  ].filter(Boolean);
  return parts.length ? `使用中: ${parts.join("・")}` : "未使用";
}

export function V2AccessGateEditor() {
  const [gates, setGates] = useState<AccessGate[] | null>(null);
  /** 鍵ごとの付け先の数。付いているコンテンツの数だけで、開いた人や人数は持たない。 */
  const [usage, setUsage] = useState<Record<string, AccessGateUsage>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<GateDraft>(emptyGateDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 新規は「トークンを鍵にする」かんたん設定から始め、「詳細設定」で全項目の編集に移る。 */
  const [simple, setSimple] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/access-gates", { cache: "no-store" });
      if (!response.ok) {
        setLoadError(response.status === 401 ? "ログインすると閲覧条件を作れます。" : await readApiError(response, "閲覧条件を読み込めませんでした。"));
        return;
      }
      const payload = (await response.json()) as { gates?: AccessGate[]; usage?: Record<string, AccessGateUsage> };
      setGates(Array.isArray(payload.gates) ? payload.gates : []);
      setUsage(payload.usage && typeof payload.usage === "object" ? payload.usage : {});
      setLoadError(null);
    } catch {
      setLoadError("通信できませんでした。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = () => {
    setDraft(emptyGateDraft());
    setErrors([]);
    setNotice(null);
    setSimple(true);
    setEditingId("new");
  };
  const startEdit = (gate: AccessGate) => {
    setDraft(draftFromGate(gate));
    setErrors([]);
    setNotice(null);
    setSimple(false);
    setEditingId(gate.id);
  };

  const updateCondition = (key: string, patch: Partial<ConditionDraft>) =>
    setDraft((current) => ({ ...current, conditions: current.conditions.map((item) => (item.key === key ? { ...item, ...patch } : item)) }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const result = validateGateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const isNew = editingId === "new";
      const response = await fetch(isNew ? "/api/access-gates" : `/api/access-gates/${encodeURIComponent(String(editingId))}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.input),
      });
      if (!response.ok) {
        setErrors([await readApiError(response, "閲覧条件を保存できませんでした。")]);
        return;
      }
      setEditingId(null);
      setNotice("閲覧条件を保存しました。");
      await load();
    } catch {
      setErrors(["通信できませんでした。"]);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (gate: AccessGate) => {
    setNotice(null);
    try {
      const response = await fetch(`/api/access-gates/${encodeURIComponent(gate.id)}`, { method: "DELETE" });
      if (response.status === 409) {
        setNotice("コンテンツに付いているため削除できません。先にコンテンツから外してください。");
        return;
      }
      if (!response.ok) {
        setNotice(await readApiError(response, "閲覧条件を削除できませんでした。"));
        return;
      }
      setNotice("閲覧条件を削除しました。");
      await load();
    } catch {
      setNotice("通信できませんでした。");
    }
  };

  return (
    <>
    <V2ColumnHead
      heading
      title="鍵"
      action={editingId === null && gates && gates.length > 0 ? <Button variant="primary" label="鍵を作る" onClick={startNew} /> : undefined}
    />
    <section className="v2-gate" aria-label="鍵">
      {loadError ? <p className="v2-error" role="alert">{loadError}</p> : null}
      {notice ? <p className="v2-note" role="status">{notice}</p> : null}

      {gates === null && !loadError ? <p className="v2-note">読み込み中…</p> : null}
      {gates && gates.length === 0 && editingId === null ? <V2Empty title="鍵はまだありません" action={{ label: "鍵を作る", onClick: startNew }} /> : null}
      {gates && gates.length > 0 && editingId === null ? (
        <ul className="v2-gate__list">
          {gates.map((gate) => (
            <li key={gate.id} className="v2-gate__item">
              <strong className="v2-gate__title">{gate.description || "（説明なし）"}</strong>
              <span className="v2-gate__meta">{matchLabel(gate.match)}</span>
              <ul>{gate.conditions.map((condition) => <li key={condition.ordinal}>{summarizeCondition(condition)}</li>)}</ul>
              <span className="v2-gate__meta">{usageLabel(usage[gate.id])}</span>
              <div className="v2-gate__actions">
                <button type="button" className="v2-gate__button" onClick={() => startEdit(gate)}>編集</button>
                <button type="button" className="v2-gate__button v2-gate__button--danger" onClick={() => void remove(gate)}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {editingId === null ? null : editingId === "new" && simple ? (
        <V2GatePassForm
          onCancel={() => setEditingId(null)}
          onAdvanced={() => setSimple(false)}
          onSaved={() => {
            setEditingId(null);
            setNotice("閲覧条件を保存しました。");
            void load();
          }}
        />
      ) : (
        <form className="v2-gate__form" onSubmit={submit} aria-label={editingId === "new" ? "鍵を作る" : "鍵を編集"}>
          <label className="v2-gate__field">
            <span>条件の組み合わせ</span>
            <select value={draft.match} onChange={(event) => setDraft({ ...draft, match: event.target.value === "all" ? "all" : "any" })}>
              <option value="any">どれか1つを満たせば閲覧できる</option>
              <option value="all">すべて満たすと閲覧できる</option>
            </select>
          </label>

          {draft.conditions.map((condition, index) => (
            <fieldset key={condition.key} className="v2-gate__condition">
              <legend>条件{index + 1}</legend>
              <label className="v2-gate__field">
                <span>種類</span>
                <select
                  aria-label={`条件${index + 1}の種類`}
                  value={condition.kind}
                  onChange={(event) => updateCondition(condition.key, { kind: event.target.value as AccessGateConditionKind })}
                >
                  {ACCESS_GATE_CONDITION_KINDS.map((kind) => <option key={kind} value={kind}>{ACCESS_GATE_KIND_LABELS[kind]}</option>)}
                  {ACCESS_GATE_SOLANA_CONDITION_KINDS.map((kind) => <option key={kind} value={kind}>{ACCESS_GATE_KIND_LABELS[kind]}</option>)}
                </select>
              </label>
              {isSolanaGateKind(condition.kind) ? (
                <label className="v2-gate__field">
                  <span>ネットワーク</span>
                  <select
                    aria-label={`条件${index + 1}のネットワーク`}
                    value={condition.chainRef || SOLANA_GATE_NETWORK_OPTIONS[0].chainRef}
                    onChange={(event) => updateCondition(condition.key, { chainRef: event.target.value })}
                  >
                    {SOLANA_GATE_NETWORK_OPTIONS.map((option) => <option key={option.chainRef} value={option.chainRef}>{option.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className="v2-gate__field">
                  <span>チェーン</span>
                  <select
                    aria-label={`条件${index + 1}のチェーン`}
                    value={condition.chainId}
                    onChange={(event) => updateCondition(condition.key, { chainId: Number(event.target.value) })}
                  >
                    {chainOptions().map((option) => <option key={option.chainId} value={option.chainId}>{option.name}</option>)}
                  </select>
                </label>
              )}
              {condition.kind === "sol_native" || condition.kind === "spl_mints" ? null : (
              <label className="v2-gate__field">
                <span>{condition.kind === "spl" ? "ミントアドレス" : "コントラクトアドレス"}</span>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0x…"
                  aria-label={`条件${index + 1}のコントラクトアドレス`}
                  value={condition.contract}
                  onChange={(event) => updateCondition(condition.key, { contract: event.target.value })}
                />
              </label>
              )}
              {condition.kind === "erc20" || condition.kind === "spl" || condition.kind === "sol_native" ? (
                <>
                  <label className="v2-gate__field">
                    <span>必要な量（人が読む単位）</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="例: 100"
                      aria-label={`条件${index + 1}の必要な量`}
                      value={condition.amount}
                      onChange={(event) => updateCondition(condition.key, { amount: event.target.value })}
                    />
                  </label>
                  {condition.kind === "sol_native" ? null : <label className="v2-gate__field">
                    <span>小数桁数（decimals）</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`条件${index + 1}の小数桁数`}
                      value={condition.decimals}
                      onChange={(event) => updateCondition(condition.key, { decimals: event.target.value })}
                    />
                  </label>}
                </>
              ) : null}
              {condition.kind === "erc1155" ? (
                <label className="v2-gate__field">
                  <span>必要な個数</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="1"
                    aria-label={`条件${index + 1}の必要な個数`}
                    value={condition.amount}
                    onChange={(event) => updateCondition(condition.key, { amount: event.target.value })}
                  />
                </label>
              ) : null}
              {condition.kind !== "erc20" && condition.kind !== "sol_native" && condition.kind !== "spl" ? (
                <label className="v2-gate__field">
                  <span>{condition.kind === "spl_mints" ? "ミントアドレス（空白かカンマで区切る・20件まで）" : condition.kind === "erc1155" ? "トークンID（1つ）" : "トークンID（省略可。空ならコレクション全体）"}</span>
                  <input
                    type="text"
                    autoComplete="off"
                    aria-label={`条件${index + 1}のトークンID`}
                    value={condition.tokenIds}
                    onChange={(event) => updateCondition(condition.key, { tokenIds: event.target.value })}
                  />
                </label>
              ) : null}
              {draft.conditions.length > 1 ? (
                <button
                  type="button"
                  className="v2-gate__button"
                  onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((item) => item.key !== condition.key) })}
                >
                  この条件を外す
                </button>
              ) : null}
            </fieldset>
          ))}
          {draft.conditions.length < ACCESS_GATE_MAX_CONDITIONS ? (
            <button type="button" className="v2-gate__button" onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, emptyCondition()] })}>条件を足す</button>
          ) : null}

          <label className="v2-gate__field">
            <span>説明（{draft.description.length}/{ACCESS_GATE_MAX_DESCRIPTION_LENGTH}字。URLは自動でリンクになりません）</span>
            <textarea
              rows={3}
              maxLength={ACCESS_GATE_MAX_DESCRIPTION_LENGTH + 20}
              aria-label="説明"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <label className="v2-gate__field">
            <span>入手先リンク（省略可。httpsのURL1つ）</span>
            <input
              type="url"
              autoComplete="off"
              placeholder="https://"
              aria-label="入手先リンク"
              value={draft.acquisitionUrl}
              onChange={(event) => setDraft({ ...draft, acquisitionUrl: event.target.value })}
            />
          </label>
          <p className="v2-note">入手先リンクは「作成者が指定した外部のページ（ハブの外へ移動します）」として表示されます。ハブは価格の比較や取引の案内をしません。</p>

          {errors.length > 0 ? (
            <ul className="v2-error" role="alert">
              {errors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          ) : null}
          <div className="v2-gate__actions">
            <button type="button" className="v2-gate__button" onClick={() => setEditingId(null)} disabled={saving}>やめる</button>
            <button type="submit" className="v2-gate__button v2-gate__button--primary" disabled={saving}>{saving ? "保存しています…" : "保存する"}</button>
          </div>
        </form>
      )}
    </section>
    </>
  );
}
