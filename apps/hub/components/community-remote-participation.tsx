"use client";

import { useCallback, useEffect, useState } from "react";

import { UiButton, UiCard } from "@/components/ui/primitives";

/*
 * 「他のハブからの参加」（オーナー/モデレーターの運営画面）。既定はオフ。
 * オンにすると、公開チャンネルの発言が他のハブにも配られ、他のハブの利用者が参加を申し込めるようになる。
 * 外部メンバーは「メンバー」まで。モデレーター・ガバナンスの投票には加われない。
 */

type State = {
  enabled: boolean;
  visibility: "public" | "approval" | "private";
  address: string | null;
  federationAvailable: boolean;
  members: { active: number; pending: number };
  held: number;
};
type Held = { objectUrl: string; reason: string | null; body: string; authorHandle: string; authorName: string; createdAt: string };

const REASONS: Record<string, string> = { links: "リンクが多い" };

export function CommunityRemoteParticipationControls({ communityId }: { communityId: string }) {
  const endpoint = `/api/communities/${encodeURIComponent(communityId)}/remote`;
  const [state, setState] = useState<State | null>(null);
  const [held, setHeld] = useState<Held[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      // 運営権限が無い画面では何も出さない。
      if (response.status === 401 || response.status === 403 || response.status === 404) { setState(null); setError(""); return; }
      if (!response.ok) throw new Error(payload?.error ?? "設定を読み込めませんでした。");
      setState(payload as State);
      setError("");
      if ((payload as State).enabled) {
        const heldResponse = await fetch(`${endpoint}/held`, { cache: "no-store" });
        const heldPayload = await heldResponse.json().catch(() => null);
        setHeld(heldResponse.ok && Array.isArray(heldPayload?.held) ? heldPayload.held : []);
      } else {
        setHeld([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "設定を読み込めませんでした。");
    }
  }, [endpoint]);

  // 開いたときに初めて読む（運営画面を開くたびに余分な通信をしない）。
  useEffect(() => { if (opened) void load(); }, [opened, load]);

  async function toggle() {
    if (!state || busy) return;
    const next = !state.enabled;
    if (next && !window.confirm("他のハブの利用者がこのコミュニティに参加できるようになります。公開チャンネルの発言は他のハブにも配られます。よろしいですか。")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "設定を変更できませんでした。");
      setState(payload as State);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "設定を変更できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function decide(objectUrl: string, decision: "release" | "discard") {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}/held`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objectUrl, decision }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "操作できませんでした。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary>
        <strong>他のハブからの参加</strong>{" "}
        <small>他のハブの利用者がこのコミュニティに参加し、公開チャンネルに書き込めるようにします（既定はオフ）。</small>
      </summary>
      {error ? <p role="alert">{error}</p> : null}
      {state ? (
        <UiCard>
          <p>
            {state.enabled ? "オン" : "オフ"}
            {state.visibility === "private" ? "（非公開のコミュニティは、他のハブに公開できません）" : ""}
          </p>
          <ul>
            <li>外部メンバーは「メンバー」までです。モデレーターにも、ガバナンスの投票者にもなれません。</li>
            <li>他のハブの書き込みは、このコミュニティの規則（ミュート・低速モード・投稿回数など）を通ってから表示されます。リンクが多い書き込みは保留され、下で確認できます。</li>
            <li>ここで消した発言や、外した・禁止したメンバーは、他のハブにも伝わります。他のハブに残った写しまでは消せません。</li>
          </ul>
          {state.enabled && state.address ? <p>他のハブからの参加先: <code>{state.address}</code>（参加中 {state.members.active}人・承認待ち {state.members.pending}人）</p> : null}
          {!state.federationAvailable ? <p>連合のサービスにつながっていないため、オンにできません。</p> : null}
          <UiButton tone={state.enabled ? "danger" : "primary"} pending={busy} onClick={() => void toggle()} disabled={!state.enabled && (state.visibility === "private" || !state.federationAvailable)}>
            {state.enabled ? "オフにする" : "オンにする"}
          </UiButton>
        </UiCard>
      ) : null}
      {held.length ? (
        <div>
          <h4>保留中の書き込み（{held.length}）</h4>
          {held.map((item) => (
            <UiCard key={item.objectUrl}>
              <strong>{item.authorName}</strong> <small>@{item.authorHandle} · {REASONS[item.reason ?? ""] ?? "確認待ち"}</small>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.body}</p>
              <UiButton tone="primary" size="compact" disabled={busy} onClick={() => void decide(item.objectUrl, "release")}>公開する</UiButton>{" "}
              <UiButton size="compact" disabled={busy} onClick={() => void decide(item.objectUrl, "discard")}>捨てる</UiButton>
            </UiCard>
          ))}
        </div>
      ) : null}
    </details>
  );
}
