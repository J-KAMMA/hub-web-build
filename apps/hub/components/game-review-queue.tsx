"use client";

import { useEffect, useRef, useState } from "react";

type Game = { id: string; title: string; summary: string; platforms: string; official_url: string | null; created_at: string };
type Proposal = { id: string; game_title: string; proposed_fields: string; reason: string; created_at: string };
type RowOperation = { pending: boolean; error?: string };

const COMPLETION_ERROR = "操作を完了できませんでした。";
const RECEIPT_ERROR = "操作の結果を確認できませんでした。";
const NO_PROPOSALS: Proposal[] = [];

function parsePlatforms(value: string): { platforms: string[] } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((platform) => typeof platform === "string")) return { platforms: parsed };
  } catch {
    // The queue must still render when stored data is malformed.
  }
  return { error: "対応機種を表示できません。" };
}

function parseProposalFields(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return { fields: parsed };
  } catch {
    // A malformed proposal must not enable applying an unknown payload.
  }
  return { error: "提案内容を表示できません。" };
}

async function confirmedReceipt(response: Response) {
  if (response.status !== 200) return { error: response.ok ? RECEIPT_ERROR : COMPLETION_ERROR };
  try {
    const receipt: unknown = await response.json();
    return typeof receipt === "object" && receipt !== null && (receipt as { ok?: unknown }).ok === true
      ? { ok: true as const }
      : { error: RECEIPT_ERROR };
  } catch {
    return { error: RECEIPT_ERROR };
  }
}

export function GameReviewQueue({ initialGames, initialProposals }: { initialGames: Game[]; initialProposals?: Proposal[] }) {
  const proposalsFromProps = initialProposals ?? NO_PROPOSALS;
  const [games, setGames] = useState(initialGames);
  const [proposals, setProposals] = useState(proposalsFromProps);
  const [operations, setOperations] = useState<Record<string, RowOperation>>({});
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const operationsRef = useRef<Record<string, RowOperation>>({});
  const dataVersionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    dataVersionRef.current += 1;
    operationsRef.current = {};
    setGames(initialGames);
    setProposals(proposalsFromProps);
    setOperations({});
  }, [initialGames, proposalsFromProps]);

  function operationFor(rowKey: string) {
    return operations[rowKey] ?? { pending: false };
  }

  function beginOperation(rowKey: string) {
    if (operationsRef.current[rowKey]?.pending) return false;
    const next = { ...operationsRef.current, [rowKey]: { pending: true } };
    operationsRef.current = next;
    setOperations(next);
    return true;
  }

  function finishOperation(rowKey: string, dataVersion: number, error?: string) {
    if (!mountedRef.current || dataVersionRef.current !== dataVersion) return;
    const next = { ...operationsRef.current, [rowKey]: { pending: false, ...(error ? { error } : {}) } };
    operationsRef.current = next;
    setOperations(next);
  }

  async function runGameAction(gameId: string, action: "publish" | "reject" | "merge") {
    const rowKey = `game:${gameId}`;
    const targetGameId = mergeTargets[gameId]?.trim();
    if (action === "merge" && (!targetGameId || targetGameId === gameId)) return;
    if (!beginOperation(rowKey)) return;
    const dataVersion = dataVersionRef.current;

    try {
      const body = action === "merge" ? { gameId, action, targetGameId } : { gameId, action };
      const receipt = await confirmedReceipt(await fetch("/api/admin/games", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      if ("ok" in receipt && receipt.ok) {
        if (mountedRef.current && dataVersionRef.current === dataVersion) setGames((current) => current.filter((game) => game.id !== gameId));
        finishOperation(rowKey, dataVersion);
      } else {
        finishOperation(rowKey, dataVersion, receipt.error);
      }
    } catch {
      finishOperation(rowKey, dataVersion, RECEIPT_ERROR);
    }
  }

  async function runProposalAction(proposalId: string, action: "accept" | "reject") {
    const rowKey = `proposal:${proposalId}`;
    if (!beginOperation(rowKey)) return;
    const dataVersion = dataVersionRef.current;

    try {
      const receipt = await confirmedReceipt(await fetch(`/api/admin/games/edits/${proposalId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      }));
      if ("ok" in receipt && receipt.ok) {
        if (mountedRef.current && dataVersionRef.current === dataVersion) setProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
        finishOperation(rowKey, dataVersion);
      } else {
        finishOperation(rowKey, dataVersion, receipt.error);
      }
    } catch {
      finishOperation(rowKey, dataVersion, RECEIPT_ERROR);
    }
  }

  return <section className="game-review-queue">
    <header><h1>ゲーム登録の審査</h1><span>{games.length}件</span></header>
    {games.map((game) => {
      const rowKey = `game:${game.id}`;
      const operation = operationFor(rowKey);
      const parsedPlatforms = parsePlatforms(game.platforms);
      const mergeTarget = mergeTargets[game.id] ?? "";
      const mergeBlocked = !mergeTarget.trim() || mergeTarget.trim() === game.id;
      return <article key={game.id}>
        <div>
          <small>{new Date(game.created_at).toLocaleDateString("ja-JP")}</small><h2>{game.title}</h2><p>{game.summary}</p>
          {"platforms" in parsedPlatforms ? <span>{parsedPlatforms.platforms.length ? parsedPlatforms.platforms.join(" / ") : "対応機種は未指定です。"}</span> : <p role="status">{parsedPlatforms.error}</p>}
          {game.official_url && <a href={game.official_url} target="_blank" rel="noreferrer">公式情報を確認</a>}
          <label><span>重複時の統合先ゲームID</span><input value={mergeTarget} disabled={operation.pending} onChange={(event) => setMergeTargets((current) => ({ ...current, [game.id]: event.target.value }))} /></label>
          {mergeTarget.trim() === game.id && <p role="status">統合先には別のゲームIDを指定してください。</p>}
          <button type="button" disabled={operation.pending || mergeBlocked} onClick={() => runGameAction(game.id, "merge")}>既存ゲームへ統合</button>
          {operation.error && <p role="alert">{operation.error}</p>}
        </div>
        <div><button type="button" disabled={operation.pending} onClick={() => runGameAction(game.id, "reject")}>却下</button><button type="button" disabled={operation.pending} onClick={() => runGameAction(game.id, "publish")}>公開</button></div>
      </article>;
    })}
    {games.length === 0 && <p>審査待ちのゲームはありません。</p>}
    <header><h2>情報の編集提案</h2><span>{proposals.length}件</span></header>
    {proposals.map((proposal) => {
      const rowKey = `proposal:${proposal.id}`;
      const operation = operationFor(rowKey);
      const parsedFields = parseProposalFields(proposal.proposed_fields);
      return <article key={proposal.id}>
        <div><small>{proposal.game_title}</small>{"fields" in parsedFields ? <pre>{JSON.stringify(parsedFields.fields, null, 2)}</pre> : <p role="status">{parsedFields.error}</p>}<p>{proposal.reason}</p>{operation.error && <p role="alert">{operation.error}</p>}</div>
        <div><button type="button" disabled={operation.pending} onClick={() => runProposalAction(proposal.id, "reject")}>却下</button><button type="button" disabled={operation.pending || !("fields" in parsedFields)} onClick={() => runProposalAction(proposal.id, "accept")}>反映</button></div>
      </article>;
    })}
  </section>;
}
