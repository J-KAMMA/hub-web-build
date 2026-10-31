"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AccessGate, AccessGateTargetType } from "@/lib/access-gates/types";
import { V2Button } from "@/components/v2/v2-button";
import { V2GatePassForm } from "@/components/v2/v2-gate-pass-form";
import { ACCESS_GATE_KIND_LABELS, VIDEO_REFERENCE_NOTE, applyAccessGate, chainName, matchLabel, rawToHuman, shortContract } from "@/components/v2/v2-access-gate-shared";

import "./v2-access-gates.css";

/*
 * 「閲覧条件」セレクタ。投稿・記事・動画・スレッド・チャンネルの作成／編集面に1つ置く。
 *  - targetId があるとき（編集面）: 選ぶとすぐ付け外しする。
 *  - targetId が無いとき（作成面）: 選んだ gateId を onChange で親へ渡す。親は保存に成功したあと
 *    applyAccessGate(targetType, 新しいID, gateId) を呼ぶ。
 */

const KIND_SHORT = { erc20: "ERC-20", erc721: "NFT", erc1155: "マルチトークン" } as const;

/** 選択肢の名前。説明があればそれ、無ければ 種類・短い契約・チェーン・量。 */
export function gateOptionLabel(gate: Pick<AccessGate, "description" | "conditions">): string {
  const description = gate.description.trim();
  if (description) return description;
  const first = gate.conditions[0];
  if (!first) return "条件なし";
  const base = `${(KIND_SHORT as Record<string, string | undefined>)[first.kind] ?? ACCESS_GATE_KIND_LABELS[first.kind]} ${shortContract(first.contract)} · ${chainName(first.chainId)}`;
  const amount = first.kind === "erc20" ? ` · ${rawToHuman(first.minRaw, first.decimals)}以上` : first.kind === "erc1155" ? ` · ${first.minRaw}個以上` : "";
  const more = gate.conditions.length > 1 ? `（ほか${gate.conditions.length - 1}件）` : "";
  return `${base}${amount}${more}`;
}

// Every composer on a page (the main one and each reply box) reads the list on load,
// so they share one request for a minute instead of one each.
const SHARED_GATES_TTL_MS = 60_000;
let sharedGates: { at: number; promise: Promise<AccessGate[]> } | null = null;

export function forgetSharedAccessGates() {
  sharedGates = null;
}

function loadSharedAccessGates(): Promise<AccessGate[]> {
  if (sharedGates && Date.now() - sharedGates.at < SHARED_GATES_TTL_MS) return sharedGates.promise;
  const promise = Promise.resolve(fetch("/api/access-gates", { cache: "no-store" }))
    .then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const payload = (await response.json()) as { gates?: AccessGate[] };
      return Array.isArray(payload.gates) ? payload.gates : [];
    })
    .catch(() => {
      sharedGates = null;
      return [] as AccessGate[];
    });
  sharedGates = { at: Date.now(), promise };
  return promise;
}

function useAccessGates(skip = false): [AccessGate[] | null, Dispatch<SetStateAction<AccessGate[] | null>>] {
  const [gates, setGates] = useState<AccessGate[] | null>(null);
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    void loadSharedAccessGates().then((loaded) => {
      if (!cancelled) setGates(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [skip]);
  return [gates, setGates];
}

type Props = {
  targetType: AccessGateTargetType;
  targetId?: string | null;
  /** 編集面で、いま付いている門 */
  initialGateId?: string | null;
  /** 作成面で、選択を親へ渡す */
  onChange?: (gateId: string | null) => void;
  disabled?: boolean;
  /** 親がすでに読んだ一覧。渡すと再取得しない。 */
  gatesState?: [AccessGate[] | null, Dispatch<SetStateAction<AccessGate[] | null>>];
};

export function V2AccessGateAttach({ targetType, targetId = null, initialGateId = null, onChange, disabled = false, gatesState }: Props) {
  const own = useAccessGates(Boolean(gatesState));
  const [gates, setGates] = gatesState ?? own;
  const [value, setValue] = useState<string>(initialGateId ?? "");
  // 作成面では選択を親が持つ。親が後から選んだ鍵（?gate=ID）も表示に反映する。
  useEffect(() => {
    if (!targetId) setValue(initialGateId ?? "");
  }, [initialGateId, targetId]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passOpen, setPassOpen] = useState(false);

  const change = async (next: string) => {
    const previous = value;
    setValue(next);
    setMessage(null);
    onChange?.(next || null);
    if (!targetId) return;
    setBusy(true);
    const result = await applyAccessGate(targetType, targetId, next || null);
    setBusy(false);
    if (!result.ok) {
      setValue(previous);
      onChange?.(previous || null);
      setMessage(result.message);
    }
  };

  const selected = gates?.find((gate) => gate.id === value);

  return (
    <div className="v2-gate-attach">
      <label className="v2-gate__field">
        <span>鍵にするトークンの条件</span>
        <select value={value} disabled={disabled || busy || gates === null} onChange={(event) => void change(event.target.value)}>
          <option value="">かけない（誰でも見られる）</option>
          {gates?.map((gate) => (
            <option key={gate.id} value={gate.id}>{gateOptionLabel(gate)}</option>
          ))}
        </select>
      </label>
      {passOpen ? (
        <V2GatePassForm
          advancedLabel="詳細設定"
          onCancel={() => setPassOpen(false)}
          onAdvanced={() => window.location.assign("/v2/creator/gates")}
          onSaved={(gate) => {
            forgetSharedAccessGates();
            setGates((current) => [...(current ?? []), gate]);
            setPassOpen(false);
            void change(gate.id);
          }}
        />
      ) : (
        <div className="v2-gate__actions">
          <button type="button" className="v2-gate__button" onClick={() => setPassOpen(true)} disabled={disabled || busy}>トークンを鍵にする（新しく作る）</button>
          <a className="v2-gate__link" href="/v2/creator/gates">詳細設定</a>
        </div>
      )}
      {selected ? <p className="v2-note">{matchLabel(selected.match)}（条件{selected.conditions.length}件）。条件を満たさない人には本文が表示されません。</p> : null}
      {selected && targetType === "video" ? <p className="v2-note">{VIDEO_REFERENCE_NOTE}</p> : null}
      {message ? <p className="v2-error" role="alert">{message}</p> : null}
    </div>
  );
}

/**
 * 作成面に差し込む開閉つきの形。鍵をひとつでも持つ人には最初から開く。
 * 閉じているときは選択中の鍵を1行で示す。選択は親が持つ。保存のあと applyAccessGate を呼ぶ。
 */
export function V2AccessGateAttachToggle({ targetType, gateId, onChange, disabled, preselectGateId }: {
  targetType: AccessGateTargetType;
  gateId: string | null;
  onChange: (gateId: string | null) => void;
  disabled?: boolean;
  /** URLの ?gate=ID など。自分の鍵の一覧にあるときだけ、一度だけ選ぶ。 */
  preselectGateId?: string | null;
}) {
  const gatesState = useAccessGates();
  const [gates] = gatesState;
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !preselectGateId || !gates) return;
    preselected.current = true;
    if (!gateId && gates.some((gate) => gate.id === preselectGateId)) onChange(preselectGateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gates, preselectGateId]);
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? Boolean(gateId || (gates && gates.length > 0));
  const selected = gates?.find((gate) => gate.id === gateId);
  return (
    <div className="v2-gate-attach-toggle">
      <V2Button variant="text" icon="lock" label="鍵をかける（トークンを持つ人だけが見られる）" pressed={Boolean(gateId)} expanded={open} disabled={disabled} onClick={() => setManual(!open)} />
      {!open && gateId ? <p className="v2-note v2-gate-attach__summary">鍵：{selected ? gateOptionLabel(selected) : "設定済み"}</p> : null}
      {open ? <V2AccessGateAttach targetType={targetType} initialGateId={gateId} onChange={onChange} disabled={disabled} gatesState={gatesState} /> : null}
    </div>
  );
}
