'use client';

import React, { useEffect, useRef, useState } from 'react';
import { UiButton } from '@/components/ui/primitives';
import type { CommunityGovernanceProposal } from '@/lib/domain';

type Choice = 'for' | 'against' | 'abstain';
type Action = 'start_voting' | 'close_voting' | 'execute' | 'cancel';
type Operation = { choice: Choice } | { action: Action };
type Power = { weight: number; memberWeight: number; tokenWeight: number };
type Bucket = Power & { count: number };
type Tally = { for: Bucket; against: Bucket; abstain: Bucket; total: Bucket };
type MyVote = Power & { choice: Choice; createdAt: string; updatedAt: string };
type Vote = MyVote & { proposalId: string; profileId: string };
export type CommunityGovernanceMutationResult = { proposal: CommunityGovernanceProposal; tally: Tally; myVote: MyVote | null; votes?: Vote[]; eligibleMembers: number; eligibleTokenWeight: number; eligibilityKnown: boolean };
type Context = CommunityGovernanceMutationResult & { communityId: string; proposalId: string; viewerId: string | null; snapshot: string; allowedActions: Action[]; canVote: boolean; canManage: boolean; canExecute: boolean; votingPower: Power | null; legacySnapshot: boolean; sourceBasis: 'membership' | 'recent_verified_balance'; unavailableReason: string | null };
type Payload = Operation & { operationId: string; snapshot: string };
type Attempt = { operation: Operation; payload: Payload; actor: string; context?: Context; sent: boolean; uncertain: boolean; conflict: boolean };
type Saved = { operation: Operation; result?: CommunityGovernanceMutationResult; replayed: boolean };
type Entry = { communityId: string; actorId?: string; data?: Context; attempt?: Attempt; saved?: Saved; reading?: AbortController; listeners?: Set<() => void> };
export type CommunityGovernanceMutationMemory = Map<string, Entry>;
type Props = { communityId: string; proposalId: string; actorId?: string; memory?: CommunityGovernanceMutationMemory; onChanged?: (result: CommunityGovernanceMutationResult) => void | Promise<void> };
const choices: Record<Choice, string> = { for: '賛成', against: '反対', abstain: '棄権' };
const actions: Record<Action, string> = { start_voting: '投票を開始', close_voting: '投票を締め切る', execute: '実行済みにする', cancel: '中止' };
const methods = { one_member_one_vote: '1メンバー1票', one_holder_one_vote: '保有者1人1票', token_linear: 'トークン保有量比例', token_sqrt: 'トークン平方根加重', token_log: 'トークン対数加重', dual_chamber: '複合投票（メンバー＋トークン）' };
const statuses = { discussion: '議論中', voting: '投票中', passed: '可決', rejected: '否決', executed: '実行済み', cancelled: '中止済み' };
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/[^A-Za-z0-9_-]/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && !/[\ud800-\udfff]/u.test(v);
const stored = (v: unknown, max: number, min = 1): v is string => text(v) && v.length <= max * 2 && Array.from(v).length >= min && Array.from(v).length <= max;
const date = (v: unknown): v is string => text(v) && v.length > 0 && v.length <= 64 && !/[\x00-\x1f\x7f]/.test(v) && Number.isFinite(Date.parse(v));
const hex = (v: unknown): v is string => typeof v === 'string' && v.length === 64 && !/[^a-f0-9]/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && v.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const number = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;
const fail = (): never => { throw Error('投票の状態・保存結果を確認できませんでした。'); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
// Large cohorts fail closed rather than accepting a cropped vote list.
const bounded = (v: unknown) => { if (new TextEncoder().encode(JSON.stringify(v)).length > 1024 * 1024) throw Error('投票情報が表示できる容量を超えています。保存結果は再送せず確認してください。'); };
function power(value: unknown): Power { const p = object(value); if (!number(p.weight) || !number(p.memberWeight, 0, 1) || !number(p.tokenWeight)) fail(); return { weight: p.weight, memberWeight: p.memberWeight, tokenWeight: p.tokenWeight } as Power; }
function bucket(value: unknown): Bucket { const b = object(value); for (const key of ['count', 'weight', 'memberWeight', 'tokenWeight'] as const) if (!number(b[key])) fail(); return { count: b.count, weight: b.weight, memberWeight: b.memberWeight, tokenWeight: b.tokenWeight } as Bucket; }
function tally(value: unknown): Tally {
  const v = object(value), result = { for: bucket(v.for), against: bucket(v.against), abstain: bucket(v.abstain), total: bucket(v.total) };
  for (const key of ['count', 'weight', 'memberWeight', 'tokenWeight'] as const) { const sum = result.for[key] + result.against[key] + result.abstain[key]; if (!number(sum) || result.total[key] !== sum) fail(); }
  return result;
}
function myVote(value: unknown): MyVote | null { if (value === null) return null; const v = object(value); if (!Object.hasOwn(choices, String(v.choice)) || !date(v.createdAt) || !date(v.updatedAt)) fail(); return { choice: v.choice as Choice, ...power(v), createdAt: v.createdAt as string, updatedAt: v.updatedAt as string }; }
function proposal(value: unknown, cid: string, pid: string): CommunityGovernanceProposal {
  const p = object(value);
  if (!id(p.id) || p.id !== pid || !id(p.communityId) || p.communityId !== cid || !id(p.authorProfileId) || !['guide', 'channel', 'rule', 'moderator'].includes(String(p.kind)) || !stored(p.title, 120) || !stored(p.body, 4000) || !Object.hasOwn(statuses, String(p.status)) || !Object.hasOwn(methods, String(p.votingMethod)) || !['one_member_one_vote', 'token_weighted', 'token_capped'].includes(String(p.votingStrategy)) || !['community', 'budget', 'token', 'project', 'rules', 'moderation', 'hub_policy', 'security'].includes(String(p.decisionScope)) || !['advisory', 'operator', 'timelock', 'veto'].includes(String(p.executionMode)) || !['proposal_start', 'seven_day_prior', 'time_weighted'].includes(String(p.snapshotPolicy))) fail();
  if (!positive(p.tokensPerVote) || !(p.voteWeightCap === null || number(p.voteWeightCap, 1)) || !number(p.quorum, 0) || typeof p.approvalThreshold !== 'number' || !Number.isFinite(p.approvalThreshold) || p.approvalThreshold < 0 || p.approvalThreshold > 1 || !number(p.quorumMemberBps, 0, 10000) || !number(p.quorumTokenBps, 0, 10000) || !number(p.approvalBps, 1, 10000)) fail();
  for (const key of ['governanceTokenId', 'linkedGuideProposalId'] as const) if (!(p[key] === null || id(p[key]))) fail();
  if (!(p.governanceTokenSymbol === null || stored(p.governanceTokenSymbol, 16)) || !(p.snapshotBlockNumber === null || stored(p.snapshotBlockNumber, 128, 0)) || !(p.snapshotCapturedAt === null || date(p.snapshotCapturedAt)) || !(p.executedAt === null || date(p.executedAt))) fail();
  for (const key of ['createdAt', 'updatedAt', 'votingStartsAt', 'votingEndsAt'] as const) if (!date(p[key])) fail();
  if (!Array.isArray(p.governanceTokenRules) || p.governanceTokenRules.length > 100) fail();
  const rules = (p.governanceTokenRules as unknown[]).map(value => { const r = object(value); if (!id(r.tokenId) || !stored(r.tokenSymbol, 16) || !positive(r.tokensPerVote) || !positive(r.weight) || r.weight > 1000) fail(); return { tokenId: r.tokenId, tokenSymbol: r.tokenSymbol, tokensPerVote: r.tokensPerVote, weight: r.weight } as NonNullable<CommunityGovernanceProposal['governanceTokenRules']>[number]; }); if (new Set(rules.map(r => r.tokenId)).size !== rules.length) fail();
  return { id: pid, communityId: cid, authorProfileId: p.authorProfileId, kind: p.kind, title: p.title, body: p.body, status: p.status, votingStrategy: p.votingStrategy, votingMethod: p.votingMethod, decisionScope: p.decisionScope, executionMode: p.executionMode, snapshotPolicy: p.snapshotPolicy, snapshotBlockNumber: p.snapshotBlockNumber, snapshotCapturedAt: p.snapshotCapturedAt, quorumMemberBps: p.quorumMemberBps, quorumTokenBps: p.quorumTokenBps, approvalBps: p.approvalBps, governanceTokenId: p.governanceTokenId, governanceTokenSymbol: p.governanceTokenSymbol, tokensPerVote: p.tokensPerVote, governanceTokenRules: rules, voteWeightCap: p.voteWeightCap, quorum: p.quorum, approvalThreshold: p.approvalThreshold, linkedGuideProposalId: p.linkedGuideProposalId, votingStartsAt: p.votingStartsAt, votingEndsAt: p.votingEndsAt, createdAt: p.createdAt, updatedAt: p.updatedAt, executedAt: p.executedAt } as CommunityGovernanceProposal;
}
function result(value: unknown, cid: string, pid: string): CommunityGovernanceMutationResult { const v = object(value); if (!number(v.eligibleMembers) || !number(v.eligibleTokenWeight)) fail(); return { proposal: proposal(v.proposal, cid, pid), tally: tally(v.tally), myVote: myVote(v.myVote), eligibleMembers: v.eligibleMembers as number, eligibleTokenWeight: v.eligibleTokenWeight as number, eligibilityKnown: false }; }
function context(value: unknown, cid: string, pid: string): Context {
  bounded(value); const v = object(value), current = result(v, cid, pid);
  if (v.communityId !== cid || v.proposalId !== pid || !(v.viewerId === null || id(v.viewerId)) || !hex(v.snapshot) || !Array.isArray(v.allowedActions) || v.allowedActions.length > 4 || v.allowedActions.some(a => typeof a !== 'string' || !Object.hasOwn(actions, a)) || new Set(v.allowedActions).size !== v.allowedActions.length || ['canVote', 'canManage', 'canExecute', 'legacySnapshot'].some(k => typeof v[k] !== 'boolean') || !['membership', 'recent_verified_balance'].includes(String(v.sourceBasis)) || !(v.unavailableReason === null || stored(v.unavailableReason, 2000))) fail();
  const votingPower = v.votingPower === null ? null : power(v.votingPower), allowed = v.allowedActions as Action[], status = current.proposal.status;
  if ((v.viewerId === null && (v.canVote || v.canManage || v.canExecute || allowed.length || current.myVote)) || (v.canVote && (status !== 'voting' || !votingPower || votingPower.weight < 1 || v.unavailableReason !== null)) || (v.canExecute && (status !== 'passed' || !v.canManage)) || allowed.some(a => (a !== 'cancel' && v.unavailableReason !== null) || (a === 'execute' ? !v.canExecute || status !== 'passed' : !v.canManage || (a === 'start_voting' ? status !== 'discussion' : a === 'close_voting' ? status !== 'voting' : !['discussion', 'voting'].includes(status))))) fail();
  return { ...current, eligibilityKnown: !v.legacySnapshot && v.unavailableReason === null, communityId: cid, proposalId: pid, viewerId: v.viewerId, snapshot: v.snapshot, allowedActions: allowed, canVote: v.canVote, canManage: v.canManage, canExecute: v.canExecute, votingPower, legacySnapshot: v.legacySnapshot, sourceBasis: v.sourceBasis, unavailableReason: v.unavailableReason } as Context;
}
const label = (op: Operation) => 'choice' in op ? choices[op.choice] : actions[op.action];
function acknowledgement(value: unknown, cid: string, pid: string, attempt: Attempt): Saved {
  bounded(value); const v = object(value), r = object(v.receipt), expected = 'choice' in attempt.operation ? 'governance_vote_cast' : 'governance_' + attempt.operation.action;
  if (!uuid(r.auditId) || r.auditId !== attempt.payload.operationId || r.action !== expected || r.targetId !== pid || !date(r.confirmedAt) || typeof r.replayed !== 'boolean' || !Array.isArray(v.votes)) fail();
  const current = result(v, cid, pid), votes: Vote[] = (v.votes as unknown[]).map(value => { const row = object(value), own = myVote(row); if (!own || row.proposalId !== pid || !id(row.profileId)) fail(); return { ...own as MyVote, proposalId: pid, profileId: row.profileId as string }; });
  if (new Set(votes.map(v => v.profileId)).size !== votes.length || current.tally.total.count !== votes.length) fail();
  for (const choice of Object.keys(choices) as Choice[]) for (const key of ['weight', 'memberWeight', 'tokenWeight'] as const) { const sum = votes.filter(v => v.choice === choice).reduce((n, v) => n + v[key], 0); if (!number(sum) || current.tally[choice][key] !== sum || current.tally[choice].count !== votes.filter(v => v.choice === choice).length) fail(); }
  const own = votes.find(v => v.profileId === attempt.actor), actual = current.myVote;
  if (Boolean(own) !== Boolean(actual) || (own && actual && (['choice', 'weight', 'memberWeight', 'tokenWeight', 'createdAt', 'updatedAt'] as const).some(k => own[k] !== actual[k]))) fail();
  return { operation: attempt.operation, result: { ...current, votes, eligibilityKnown: attempt.context?.eligibilityKnown === true }, replayed: r.replayed as boolean };
}

export function CommunityGovernanceMutationControls(props: Props) {
  const owned = useRef<CommunityGovernanceMutationMemory>(new Map()), memory = props.memory ?? owned.current, scope = useRef({ actor: props.actorId, memory, version: 0 });
  if (scope.current.actor !== props.actorId || scope.current.memory !== memory) { memory.clear(); scope.current = { actor: props.actorId, memory, version: scope.current.version + 1 }; }
  return <MutationControls key={JSON.stringify([props.communityId, props.proposalId, props.actorId ?? null, scope.current.version])} {...props} memory={memory} />;
}
function MutationControls({ communityId, proposalId, actorId, memory, onChanged }: Props & { memory: CommunityGovernanceMutationMemory }) {
  const key = JSON.stringify([communityId, proposalId, actorId ?? null]), [entry] = useState(() => { if (!memory.has(key)) memory.set(key, { communityId, actorId }); return memory.get(key)!; });
  const [loading, setLoading] = useState(true), [readReady, setReadReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [refreshError, setRefreshError] = useState(false), [, redraw] = useState(0);
  const mounted = useRef(false), generation = useRef(0), reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null), sending = useRef(false), changed = useRef(onChanged); changed.current = onChanged;
  const retained = (g: number) => generation.current === g && memory.get(key) === entry, valid = (g = generation.current) => mounted.current && retained(g), update = () => redraw(n => n + 1), endpoint = `/api/communities/${encodeURIComponent(communityId)}/governance/proposals/${encodeURIComponent(proposalId)}`;
  function clearReaders(except?: AbortController) { for (const item of memory.values()) if (item.communityId === communityId && item.actorId === actorId) { if (item.reading !== except) item.reading?.abort(); delete item.data; if (item.attempt) delete item.attempt.context; if (item.saved) delete item.saved.result; item.listeners?.forEach(notify => notify()); } }
  function invalidate() { generation.current++; reading.current?.abort(); writing.current?.abort(); clearReaders(); memory.clear(); delete entry.data; delete entry.attempt; delete entry.saved; sending.current = false; setBusy(false); setLoading(false); setReadReady(false); setError('アカウントが変わりました。投票操作の画面を開き直してください。'); update(); }
  async function sync(current: CommunityGovernanceMutationResult, g = generation.current) { if (!valid(g)) return; setRefreshError(false); try { await changed.current?.(current); } catch { if (valid(g)) setRefreshError(true); } }
  async function load(reset = false) {
    if (!valid() || sending.current) return; const g = generation.current, controller = new AbortController(); entry.reading?.abort(); reading.current = controller; entry.reading = controller; setLoading(true); setReadReady(false); setError('');
    try {
      if (!id(communityId) || !id(proposalId)) fail(); const response = await fetch(endpoint + '/context', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }), value: unknown = await response.json().catch(() => null);
      if (!valid(g) || controller.signal.aborted || entry.reading !== controller) return;
      if (!response.ok) { if ([401, 403, 404].includes(response.status)) clearReaders(controller); const message = object(value).error; throw Error(text(message) ? message : '投票の状態を取得できませんでした。'); }
      const next = context(value, communityId, proposalId); if ((actorId !== undefined && next.viewerId !== actorId) || (entry.attempt && next.viewerId !== entry.attempt.actor)) { invalidate(); return; }
      const current = { proposal: next.proposal, tally: next.tally, myVote: next.myVote, eligibleMembers: next.eligibleMembers, eligibleTokenWeight: next.eligibleTokenWeight, eligibilityKnown: next.eligibilityKnown };
      entry.data = next; if (reset) { delete entry.attempt; delete entry.saved; } else if (entry.saved) entry.saved.result = current; setReadReady(true); update(); await sync(current, g);
      if (valid(g) && !controller.signal.aborted && entry.reading === controller) return next;
    } catch (cause) { if (valid(g) && !controller.signal.aborted && entry.reading === controller) setError(cause instanceof Error ? cause.message : '投票の状態を取得できませんでした。'); }
    finally { if (valid(g) && !controller.signal.aborted && entry.reading === controller) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; const notify = () => { if (mounted.current) { setReadReady(false); setLoading(false); update(); } }; (entry.listeners ??= new Set()).add(notify); window.addEventListener('hub-account-changed', invalidate); void load(); return () => { mounted.current = false; reading.current?.abort(); writing.current?.abort(); entry.listeners?.delete(notify); window.removeEventListener('hub-account-changed', invalidate); }; }, [communityId, proposalId, actorId, memory]);
  async function preview(operation: Operation) {
    if (!valid() || busy || loading || !readReady || entry.attempt || entry.saved) return;
    const g = generation.current, data = await load();
    if (!valid(g) || !data?.viewerId || entry.data !== data || entry.attempt || entry.saved || ('choice' in operation ? !data.canVote : !data.allowedActions.includes(operation.action))) return;
    entry.attempt = { operation, payload: { ...operation, operationId: crypto.randomUUID(), snapshot: data.snapshot }, actor: data.viewerId, context: structuredClone(data), sent: false, uncertain: false, conflict: false }; setError(''); update();
  }
  async function save() {
    const attempt = entry.attempt; if (!valid() || sending.current || loading || !readReady || !attempt || attempt.conflict || entry.saved || entry.data?.viewerId !== attempt.actor) return;
    if (!attempt.sent && ('choice' in attempt.operation ? !entry.data.canVote : !entry.data.allowedActions.includes(attempt.operation.action))) return;
    const g = generation.current, controller = new AbortController(), wasUncertain = attempt.uncertain; writing.current = controller; sending.current = true; attempt.sent = true; attempt.uncertain = true; setBusy(true); setError(''); update();
    try {
      const response = await fetch(endpoint + ('choice' in attempt.operation ? '/votes' : ''), { method: 'choice' in attempt.operation ? 'POST' : 'PATCH', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), body: JSON.stringify(attempt.payload) }), value: unknown = await response.json().catch(() => null);
      if (retained(g) && [401, 403, 404].includes(response.status)) clearReaders();
      if (!valid(g) || controller.signal.aborted || entry.attempt !== attempt) return;
      if (!response.ok) { if ([400, 401, 403, 404, 409, 413].includes(response.status)) { attempt.conflict = true; attempt.uncertain = wasUncertain; } update(); const message = object(value).error; throw Error(text(message) ? message : '保存結果を確認できませんでした。同じ操作で確認してください。'); }
      entry.saved = acknowledgement(value, communityId, proposalId, attempt); update(); await sync(entry.saved.result!, g);
    } catch (cause) { if (valid(g) && !controller.signal.aborted && entry.attempt === attempt) { setError(cause instanceof Error ? cause.message : '保存結果は不明です。同じ操作で確認してください。'); update(); } }
    finally { if (valid(g) && entry.attempt === attempt) { sending.current = false; setBusy(false); } }
  }
  const data = entry.data, attempt = entry.attempt, saved = entry.saved, prepared = attempt?.context, locked = loading || busy || !readReady || Boolean(attempt) || Boolean(saved);
  function currentVote(value: MyVote | null) { return value ? choices[value.choice] : '未投票'; }
  return <section className="community-governance-mutation-controls" aria-label="提案の投票と状態変更">
    {loading && <p role="status">現在の投票状態を確認しています…</p>}
    {saved ? <section aria-label="操作の保存結果"><p>「{label(saved.operation)}」の保存を確認しました。同じ操作を再適用しません。</p>{saved.result && <><p>現在の状態：{statuses[saved.result.proposal.status]}</p><p>現在の自分の票：{currentVote(saved.result.myVote)}</p></>}{saved.replayed && <p>保存後に進んだ状態と票を表示しています。送信時の状態へ戻しません。</p>}<UiButton type="button" size="compact" disabled={busy || loading} onClick={() => void load(true)}>最新の状態を確認して次の操作へ</UiButton></section> : attempt ? <section aria-label="投票操作の確認">
      <h4>{label(attempt.operation)}内容の確認</h4>{prepared && <><h5>{prepared.proposal.title}</h5><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prepared.proposal.body}</p><p>現在の状態：{statuses[prepared.proposal.status]} ／ 現在の自分の票：{currentVote(prepared.myVote)}</p><p>投票方式：{methods[prepared.proposal.votingMethod!]}</p><p>投票開始時の資格者：{prepared.eligibleMembers}人 ／ トークン点：{prepared.eligibleTokenWeight}</p><p>定足数：{prepared.proposal.quorum}人、賛成率基準：{prepared.proposal.approvalThreshold * 100}%</p><p>メンバー参加率：{(prepared.proposal.quorumMemberBps ?? 0) / 100}%、トークン参加率：{(prepared.proposal.quorumTokenBps ?? 0) / 100}%、複合投票の賛成率：{(prepared.proposal.approvalBps ?? 0) / 100}%</p><p>賛成 {prepared.tally.for.weight} ／ 反対 {prepared.tally.against.weight} ／ 棄権 {prepared.tally.abstain.weight}</p>{prepared.proposal.governanceTokenRules?.length ? <ul>{prepared.proposal.governanceTokenRules.map(r => <li key={r.tokenId}>{r.tokenSymbol}：{r.tokensPerVote}枚ごとに{r.weight}点</li>)}</ul> : null}
      {prepared.sourceBasis === 'recent_verified_balance' && <p>投票開始前15分以内に確認した、トークンとウォレットの一致する検証済み残高を使用します。開始時点の特定ブロックの残高を保証するものではありません。</p>}{prepared.legacySnapshot && <p>開始時の完全な投票資格を証明できません。中止して新しい提案を作成してください。</p>}</>}
      {'choice' in attempt.operation ? <p>投票先：{choices[attempt.operation.choice]}。{prepared?.votingPower && `確認した投票力は${prepared.votingPower.weight}票です。`}既存の自分の票がある場合は、この選択に変更します。</p> : <p>{({ start_voting: '現在の有効なメンバーと確認した投票力を固定し、7日間の投票を開始します。', close_voting: '現在の集計で締め切り、可決・否決を確定します。締切後は投票できません。', execute: '実行済みの記録を付けます。必要な実作業は別に行ってください。', cancel: '提案を中止し、投票を止めます。現在の投票記録は残ります。' })[attempt.operation.action]}</p>}
      {attempt.conflict ? <><p>{attempt.uncertain ? '以前の保存結果は確定できません。' : '今回の操作は拒否されました。'}最新の状態を確認して以前の操作を閉じ、新しい操作を確認してください。自動では再送しません。</p><UiButton type="button" size="compact" disabled={busy || loading} onClick={() => void load(true)}>最新の状態を確認してやり直す</UiButton></> : <><UiButton type="button" size="compact" pending={busy} disabled={loading || !readReady || !data || data.viewerId !== attempt.actor} onClick={() => void save()}>{attempt.sent ? '同じ操作の保存結果を確認' : '確認して保存'}</UiButton>{!attempt.sent && <UiButton type="button" size="compact" disabled={busy} onClick={() => { delete entry.attempt; update(); }}>操作の選択に戻る</UiButton>}{attempt.sent && <p>選択と操作を固定しています。結果を確認するまで別の操作はできません。</p>}</>}
    </section> : data && <><p>現在の状態：{statuses[data.proposal.status]} ／ 現在の自分の票：{currentVote(data.myVote)}</p>{data.unavailableReason && <p role="status">{data.unavailableReason}</p>}{data.sourceBasis === 'recent_verified_balance' && data.proposal.status === 'discussion' && <p>投票開始には、15分以内に確認したトークンとウォレットの一致する検証済み残高を使用します。</p>}
      <span className="community-governance-proposal__actions">{data.allowedActions.map(action => <UiButton type="button" size="compact" key={action} disabled={locked} onClick={() => preview({ action })}>{actions[action]}</UiButton>)}{data.proposal.status === 'voting' && (Object.keys(choices) as Choice[]).map(choice => <UiButton type="button" size="compact" key={choice} aria-pressed={data.myVote?.choice === choice} disabled={locked || !data.canVote} onClick={() => preview({ choice })}>{choices[choice]}</UiButton>)}</span>{data.viewerId === null && <p>投票・状態変更にはHubへのログインと必要なメンバー資格が必要です。</p>}
    </>}
    {error && <p role="alert">{saved ? '操作は保存済みです。' : ''}{error}</p>}{refreshError && <><p role="status">{saved ? '操作は保存済みですが、' : '最新の状態は確認できましたが、'}一覧の更新を確認できませんでした。</p>{saved?.result && <UiButton type="button" size="compact" disabled={busy} onClick={() => void sync(saved.result!)}>一覧の表示を更新する</UiButton>}</>}
    {!loading && !saved && !attempt?.conflict && <UiButton type="button" size="compact" disabled={busy || !valid()} onClick={() => void load()}>投票状態を再読み込み</UiButton>}
  </section>;
}
