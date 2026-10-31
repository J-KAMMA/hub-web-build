'use client';

import React, { useEffect, useRef, useState } from 'react';
import { UiButton, UiInput, UiSelect, UiTextarea } from '@/components/ui/primitives';
import { validateGovernanceProposalPolicy } from '@/lib/community-governance';
import type { CommunityGovernanceProposal } from '@/lib/domain';
import type { CommunityGovernanceSettings } from './community-governance-settings';

const kinds = { guide: '共同ページの編集', channel: 'チャンネル', rule: 'コミュニティルール', moderator: 'モデレーター' };
const methods = { one_member_one_vote: '1メンバー1票', one_holder_one_vote: '保有者1人1票', token_linear: 'トークン保有量比例', token_sqrt: 'トークン平方根加重', token_log: 'トークン対数加重', dual_chamber: '複合投票（メンバー＋トークン）' };
const scopes = { community: 'コミュニティの通常事項', budget: '予算・報奨金', token: 'トークン固有事項', project: 'プロジェクト優先順位', rules: 'コミュニティ規約', moderation: 'モデレーション（意向調査のみ）' };
const effects = { advisory: '意向調査（拘束力なし）', operator: '運営実行型', timelock: 'タイムロック後に実行', veto: '安全上の拒否権付き' };
type Draft = { kind: keyof typeof kinds; title: string; body: string; linkedGuideProposalId: string; votingMethod: keyof typeof methods; decisionScope: keyof typeof scopes; executionMode: keyof typeof effects };
type Payload = Omit<Draft, 'linkedGuideProposalId'> & { linkedGuideProposalId: string | null; operationId: string; snapshot: string; snapshotPolicy: 'proposal_start'; quorumMemberBps: number; quorumTokenBps: number; approvalBps: number };
type Context = { communityId: string; viewerId: string | null; canCreate: boolean; settings: CommunityGovernanceSettings; memberCount: number; snapshot: string };
type Attempt = { payload: Payload; context: Context; guideTitle: string | null; sent: boolean; uncertain: boolean; conflict: boolean };
type Saved = { proposal?: CommunityGovernanceProposal; memberCount: number; replayed: boolean };
type Entry = { data?: Context; draft?: Draft; attempt?: Attempt; saved?: Saved };
export type CommunityGovernanceCreateMemory = Map<string, Entry>;
type Props = { communityId: string; communityName?: string; actorId?: string; guideProposals: { id: string; title: string }[]; memory?: CommunityGovernanceCreateMemory; onCreated?: (proposal: CommunityGovernanceProposal, memberCount: number) => void | Promise<void>; onClose?: () => void };
const blank = (): Draft => ({ kind: 'rule', title: '', body: '', linkedGuideProposalId: '', votingMethod: 'one_member_one_vote', decisionScope: 'community', executionMode: 'operator' });
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/[^A-Za-z0-9_-]/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && !/[\ud800-\udfff]/u.test(v);
const date = (v: unknown): v is string => text(v) && v.length > 0 && v.length <= 64 && !/[\x00-\x1f\x7f]/.test(v) && Number.isFinite(Date.parse(v));
const hex = (v: unknown): v is string => typeof v === 'string' && v.length === 64 && !/[^a-f0-9]/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && v.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;
const limit = (v: unknown): v is number | null => v === null || integer(v, 1);
const invalid = (): never => { throw Error('提案の設定・保存結果を確認できませんでした。'); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const bounded = (v: unknown) => { if (new TextEncoder().encode(JSON.stringify(v)).length > 512 * 1024) invalid(); };
function settings(value: unknown): CommunityGovernanceSettings {
  const v = object(value);
  if (!['one_member_one_vote', 'token_weighted', 'token_capped'].includes(String(v.votingStrategy)) || !(v.governanceTokenId === null || id(v.governanceTokenId)) || !positive(v.tokensPerVote) || !limit(v.voteWeightCap) || !Array.isArray(v.tokenRules) || v.tokenRules.length > 100) invalid();
  const tokenRules = (v.tokenRules as unknown[]).map(value => { const r = object(value); if (!id(r.tokenId) || !text(r.tokenSymbol) || r.tokenSymbol.length > 32 || Array.from(r.tokenSymbol).length < 1 || Array.from(r.tokenSymbol).length > 16 || !positive(r.tokensPerVote) || !positive(r.weight) || r.weight > 1000) invalid(); return { tokenId: r.tokenId, tokenSymbol: r.tokenSymbol, tokensPerVote: r.tokensPerVote, weight: r.weight } as CommunityGovernanceSettings['tokenRules'][number]; });
  if (new Set(tokenRules.map(r => r.tokenId)).size !== tokenRules.length) invalid();
  return { votingStrategy: v.votingStrategy, governanceTokenId: v.governanceTokenId, tokensPerVote: v.tokensPerVote, tokenRules, voteWeightCap: v.voteWeightCap } as CommunityGovernanceSettings;
}
function context(value: unknown, cid: string): Context {
  bounded(value); const v = object(value);
  if (!id(v.communityId) || v.communityId !== cid || !(v.viewerId === null || id(v.viewerId)) || typeof v.canCreate !== 'boolean' || (v.canCreate && v.viewerId === null) || !integer(v.memberCount) || !hex(v.snapshot)) invalid();
  return { communityId: cid, viewerId: v.viewerId, canCreate: v.canCreate, settings: settings(v.settings), memberCount: v.memberCount, snapshot: v.snapshot } as Context;
}
function acknowledgement(value: unknown, cid: string, attempt: Attempt): Saved {
  bounded(value); const v = object(value), r = object(v.receipt), p = object(v.proposal), expected = attempt.payload, pid = 'governance-' + expected.operationId;
  if (!uuid(r.auditId) || r.auditId !== expected.operationId || r.action !== 'governance_proposal_created' || r.targetId !== pid || !date(r.confirmedAt) || typeof r.replayed !== 'boolean' || p.id !== pid || p.communityId !== cid || p.authorProfileId !== attempt.context.viewerId) invalid();
  for (const key of ['kind', 'title', 'body', 'linkedGuideProposalId', 'votingMethod', 'decisionScope', 'executionMode', 'snapshotPolicy', 'quorumMemberBps', 'quorumTokenBps', 'approvalBps'] as const) if (p[key] !== expected[key]) invalid();
  if (!['discussion', 'voting', 'passed', 'rejected', 'executed', 'cancelled'].includes(String(p.status)) || !text(p.title) || p.title.length > 120 || !text(p.body) || p.body.length > 4000 || !integer(p.quorum, 1) || p.quorum !== Math.max(1, Math.ceil(attempt.context.memberCount * .5)) || p.approvalThreshold !== .6 || !(p.snapshotBlockNumber === null || (text(p.snapshotBlockNumber) && p.snapshotBlockNumber.length <= 128)) || !(p.snapshotCapturedAt === null || date(p.snapshotCapturedAt)) || !(p.executedAt === null || date(p.executedAt))) invalid();
  for (const key of ['createdAt', 'updatedAt', 'votingStartsAt', 'votingEndsAt'] as const) if (!date(p[key])) invalid();
  const actual = settings({ votingStrategy: p.votingStrategy, governanceTokenId: p.governanceTokenId, tokensPerVote: p.tokensPerVote, tokenRules: p.governanceTokenRules, voteWeightCap: p.voteWeightCap });
  const tokenMethod = expected.votingMethod !== 'one_member_one_vote', configured = attempt.context.settings, rules = tokenMethod ? configured.tokenRules : [];
  if (actual.votingStrategy !== (tokenMethod ? 'token_weighted' : 'one_member_one_vote') || actual.voteWeightCap !== (configured.votingStrategy === 'token_capped' ? configured.voteWeightCap ?? 100 : null) || actual.tokenRules.length !== rules.length || actual.tokenRules.some((rule, index) => { const other = rules[index]; return !other || Object.keys(rule).some(key => rule[key as keyof typeof rule] !== other[key as keyof typeof rule]); }) || actual.governanceTokenId !== (rules[0]?.tokenId ?? null) || p.governanceTokenSymbol !== (rules[0]?.tokenSymbol ?? null) || actual.tokensPerVote !== (rules[0]?.tokensPerVote ?? 1)) invalid();
  const proposal: CommunityGovernanceProposal = { id: pid, communityId: cid, authorProfileId: p.authorProfileId as string, kind: expected.kind, title: expected.title, body: expected.body, status: p.status as CommunityGovernanceProposal['status'], votingStrategy: actual.votingStrategy, votingMethod: expected.votingMethod, decisionScope: expected.decisionScope, executionMode: expected.executionMode, snapshotPolicy: expected.snapshotPolicy, snapshotBlockNumber: p.snapshotBlockNumber as string | null, snapshotCapturedAt: p.snapshotCapturedAt as string | null, quorumMemberBps: expected.quorumMemberBps, quorumTokenBps: expected.quorumTokenBps, approvalBps: expected.approvalBps, governanceTokenId: actual.governanceTokenId, governanceTokenSymbol: p.governanceTokenSymbol as string | null, tokensPerVote: actual.tokensPerVote, governanceTokenRules: actual.tokenRules, voteWeightCap: actual.voteWeightCap, quorum: p.quorum as number, approvalThreshold: .6, linkedGuideProposalId: expected.linkedGuideProposalId, votingStartsAt: p.votingStartsAt as string, votingEndsAt: p.votingEndsAt as string, createdAt: p.createdAt as string, updatedAt: p.updatedAt as string, executedAt: p.executedAt as string | null };
  return { proposal, memberCount: attempt.context.memberCount, replayed: r.replayed as boolean };
}

export function CommunityGovernanceCreateControls(props: Props) {
  const owned = useRef<CommunityGovernanceCreateMemory>(new Map()), memory = props.memory ?? owned.current, scope = useRef({ actor: props.actorId, memory, version: 0 });
  if (scope.current.actor !== props.actorId || scope.current.memory !== memory) { memory.clear(); scope.current = { actor: props.actorId, memory, version: scope.current.version + 1 }; }
  return <CreateControls key={JSON.stringify([props.communityId, props.actorId ?? null, scope.current.version])} {...props} memory={memory} />;
}
function CreateControls({ communityId, communityName, actorId, guideProposals, memory, onCreated, onClose }: Props & { memory: CommunityGovernanceCreateMemory }) {
  const key = JSON.stringify([communityId, actorId ?? null]), [entry] = useState(() => { if (!memory.has(key)) memory.set(key, {}); return memory.get(key)!; });
  const [loading, setLoading] = useState(true), [readReady, setReadReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [refreshError, setRefreshError] = useState(false), [, redraw] = useState(0);
  const mounted = useRef(false), generation = useRef(0), epoch = useRef(0), reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null), sending = useRef(false), created = useRef(onCreated); created.current = onCreated;
  const valid = (g = generation.current) => mounted.current && g === generation.current && memory.get(key) === entry;
  const update = () => redraw(n => n + 1), endpoint = `/api/communities/${encodeURIComponent(communityId)}/governance/proposals`;
  function invalidate() { generation.current++; epoch.current++; reading.current?.abort(); writing.current?.abort(); memory.clear(); delete entry.data; delete entry.draft; delete entry.attempt; delete entry.saved; sending.current = false; setBusy(false); setLoading(false); setReadReady(false); setError('アカウントが変わりました。提案の作成画面を閉じて開き直してください。'); update(); }
  async function load(reset = false) {
    if (!valid() || sending.current) return; const g = generation.current, e = ++epoch.current, controller = new AbortController(); reading.current?.abort(); reading.current = controller; setLoading(true); setReadReady(false); setError('');
    try {
      if (!id(communityId)) invalid(); const response = await fetch(endpoint + '/context', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }), value = await response.json();
      if (!valid(g) || e !== epoch.current || controller.signal.aborted) return;
      if (!response.ok) { if ([401, 403, 404].includes(response.status)) { delete entry.data; delete entry.draft; if (entry.saved) delete entry.saved.proposal; } throw Error(text(value?.error) ? value.error : '提案の設定を取得できませんでした。'); }
      const next = context(value, communityId); if ((actorId !== undefined && next.viewerId !== actorId) || (entry.attempt && entry.attempt.context.viewerId !== next.viewerId)) { invalidate(); return; }
      entry.data = next; if (reset) { const wasSaved = Boolean(entry.saved); delete entry.attempt; delete entry.saved; if (wasSaved) entry.draft = blank(); } entry.draft ??= blank(); setReadReady(true); update();
    } catch (cause) { if (valid(g) && e === epoch.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '提案の設定を取得できませんでした。'); }
    finally { if (valid(g) && e === epoch.current && !controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; window.addEventListener('hub-account-changed', invalidate); void load(); return () => { mounted.current = false; generation.current++; epoch.current++; reading.current?.abort(); writing.current?.abort(); window.removeEventListener('hub-account-changed', invalidate); }; }, [communityId, actorId, memory]);
  function preview() {
    if (!valid() || loading || !readReady || busy || !entry.data?.canCreate || !entry.data.viewerId || !entry.draft || entry.attempt || entry.saved) return;
    const draft = entry.draft, title = draft.title.trim(), body = draft.body.trim();
    try {
      if (!Object.hasOwn(kinds, draft.kind) || !Object.hasOwn(methods, draft.votingMethod) || !Object.hasOwn(scopes, draft.decisionScope) || !Object.hasOwn(effects, draft.executionMode) || !text(draft.title) || draft.title.length > 120 || title.length < 5 || !text(draft.body) || draft.body.length > 4000 || body.length < 20) throw Error('タイトルは5〜120文字、提案内容は20〜4000文字で入力してください。');
      validateGovernanceProposalPolicy(draft); const linkedGuideProposalId = draft.kind === 'guide' ? draft.linkedGuideProposalId : null, guide = guideProposals.find(g => g.id === linkedGuideProposalId);
      if (draft.kind === 'guide' && (!id(linkedGuideProposalId) || !guide || !text(guide.title))) throw Error('参照する編集提案を選択してください。');
      if (draft.votingMethod !== 'one_member_one_vote' && entry.data.settings.tokenRules.length === 0) throw Error('投票に使用するコミュニティトークンを設定してください。');
      entry.attempt = { payload: { ...draft, title, body, linkedGuideProposalId, operationId: crypto.randomUUID(), snapshot: entry.data.snapshot, snapshotPolicy: 'proposal_start', quorumMemberBps: 2000, quorumTokenBps: draft.votingMethod === 'one_member_one_vote' ? 0 : 2000, approvalBps: draft.decisionScope === 'rules' ? 6667 : 5001 }, context: structuredClone(entry.data), guideTitle: guide?.title ?? null, sent: false, uncertain: false, conflict: false }; setError(''); update();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提案内容を確認してください。'); }
  }
  async function sync(g = generation.current) { if (!valid(g) || !entry.saved?.proposal) return; setRefreshError(false); try { await created.current?.(entry.saved.proposal, entry.saved.memberCount); } catch { if (valid(g)) setRefreshError(true); } }
  async function save() {
    const attempt = entry.attempt; if (!valid() || sending.current || loading || !readReady || !attempt || attempt.conflict || entry.saved || !entry.data?.canCreate || entry.data.viewerId !== attempt.context.viewerId) return;
    const g = generation.current, controller = new AbortController(), wasUncertain = attempt.uncertain; writing.current = controller; attempt.sent = true; attempt.uncertain = true; sending.current = true; setBusy(true); setError(''); update();
    try {
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), body: JSON.stringify(attempt.payload) }), value = await response.json();
      if (!valid(g) || controller.signal.aborted || entry.attempt !== attempt) return;
      if (!response.ok) { if ([400, 401, 403, 404, 409, 413].includes(response.status)) { attempt.conflict = true; attempt.uncertain = wasUncertain; } if ([401, 403, 404].includes(response.status)) { delete entry.data; delete entry.draft; } update(); throw Error(text(value?.error) ? value.error : '作成結果を確認できませんでした。同じ提案で確認してください。'); }
      entry.saved = acknowledgement(value, communityId, attempt); delete entry.draft; update(); await sync(g);
    } catch (cause) { if (valid(g) && !controller.signal.aborted && entry.attempt === attempt) { setError(cause instanceof Error ? cause.message : '作成結果は不明です。同じ提案で確認してください。'); update(); } }
    finally { if (valid(g) && entry.attempt === attempt) { sending.current = false; setBusy(false); } }
  }
  const data = entry.data, draft = entry.draft, attempt = entry.attempt, saved = entry.saved, locked = loading || !readReady || busy || Boolean(attempt) || Boolean(saved) || !data?.canCreate;
  const policy = draft?.kind === 'moderator' || draft?.decisionScope === 'moderation';
  const edit = (patch: Partial<Draft>) => { if (!locked && draft) { Object.assign(draft, patch); update(); } };
  function settingsPreview(source: Context, method: Draft['votingMethod']) { return <><p>確認時の有効なメンバー：{source.memberCount}人</p>{method !== 'one_member_one_vote' && <ul>{source.settings.tokenRules.map(rule => <li key={rule.tokenId}>{rule.tokenSymbol}：{rule.tokensPerVote}枚ごとに{rule.weight}点</li>)}</ul>}<p>トークン票の上限：{source.settings.voteWeightCap === null ? '上限なし' : `${source.settings.voteWeightCap}票`}</p></>; }
  return <section className="community-governance-create-controls" aria-label="DAO提案を作成"><header><h3>DAO提案を作成</h3><p>内容を確認して作成すると議論中になります。投票の開始は運営が行います。</p></header>
    {loading && <p role="status">提案の設定を確認しています…</p>}
    {saved ? <section aria-label="提案の保存結果"><p>提案の作成を確認しました。同じ操作を再送しません。</p><h4>{saved.proposal?.title}</h4>{saved.proposal&&<p>現在の状態：{({ discussion: '議論中', voting: '投票中', passed: '可決', rejected: '否決', executed: '実行済み', cancelled: '取り消し' })[saved.proposal.status]}</p>}{saved.replayed && saved.proposal && saved.proposal.status !== 'discussion' && <p>提案は作成済みで、その後に状態が進んでいます。新しく作成し直しません。</p>}{refreshError && <><p role="status">提案は保存済みですが、一覧の更新を確認できませんでした。</p><UiButton type="button" size="compact" disabled={busy} onClick={() => void sync()}>一覧を更新する</UiButton></>}<UiButton type="button" size="compact" disabled={busy || loading} onClick={() => void load(true)}>最新の設定で次の提案を作成</UiButton></section> : data && draft ? <>
      {!data.canCreate && <p>{data.viewerId === null ? '提案の作成にはHubへのログインとコミュニティへの参加が必要です。' : '現在のメンバー資格では提案を作成できません。'}</p>}
      {attempt ? <section aria-label="提案内容の確認">{communityName&&<p>対象：{communityName}</p>}<h4>{attempt.payload.title}</h4><p className="community-governance-create-controls__body">{attempt.payload.body}</p><dl><dt>種類</dt><dd>{kinds[attempt.payload.kind]}</dd><dt>決定する範囲</dt><dd>{scopes[attempt.payload.decisionScope]}</dd><dt>投票方式</dt><dd>{methods[attempt.payload.votingMethod]}</dd><dt>可決後の効果</dt><dd>{effects[attempt.payload.executionMode]}</dd>{attempt.guideTitle && <><dt>参照する編集提案</dt><dd>{attempt.guideTitle}</dd></>}<dt>成立・可決の基準</dt><dd>{attempt.payload.votingMethod === 'dual_chamber' ? <>メンバー参加率：{attempt.payload.quorumMemberBps / 100}%、トークン参加率：{attempt.payload.quorumTokenBps / 100}%、賛成率：{attempt.payload.approvalBps / 100}%</> : <>定足人数：{Math.max(1, Math.ceil(attempt.context.memberCount / 2))}人、賛否の有効票の60%以上が賛成</>}</dd></dl>{settingsPreview(attempt.context, attempt.payload.votingMethod)}{attempt.payload.votingMethod !== 'one_member_one_vote' && <p>7日前・時間加重の残高を使う集計と、委任した票の反映には未対応です。</p>}{['timelock', 'veto'].includes(attempt.payload.executionMode) && <p>この実行方針は記録のみです。時間待ちや拒否権による実行制御はまだ行われません。</p>}<p>BAN、投稿削除、違反認定、Hub共通規約、緊急セキュリティ対応は、この提案だけでは変更できません。</p>
        {attempt.conflict ? <><p>{attempt.uncertain ? '以前の作成結果は確定できません。' : '今回の作成は拒否されました。'}最新の設定を確認して以前の操作を閉じ、新しい内容を確認してください。自動では作成しません。</p><UiButton type="button" size="compact" disabled={busy || loading} onClick={() => void load(true)}>最新の設定を確認してやり直す</UiButton></> : <><UiButton type="button" size="compact" pending={busy} disabled={loading || !readReady || !data.canCreate} onClick={() => void save()}>{attempt.sent ? '同じ提案の作成結果を確認' : '確認して議論を開始'}</UiButton>{!attempt.sent && <UiButton type="button" size="compact" onClick={() => { delete entry.attempt; update(); }}>編集に戻る</UiButton>}{attempt.sent && <p>送信した内容を固定しています。結果が確認できるまで編集できません。</p>}</>}
      </section> : <form onSubmit={event => { event.preventDefault(); preview(); }}>
        <label className="community-governance-create-controls__field"><span>提案の種類</span><UiSelect aria-label="提案の種類" value={draft.kind} disabled={locked} onChange={event => { const kind = event.target.value as Draft['kind']; edit(kind === 'moderator' ? { kind, decisionScope: 'moderation', votingMethod: 'one_member_one_vote', executionMode: 'advisory' } : { kind }); }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UiSelect></label>
        <label className="community-governance-create-controls__field"><span>決定する範囲</span><UiSelect aria-label="決定する範囲" value={draft.decisionScope} disabled={locked} onChange={event => { const decisionScope = event.target.value as Draft['decisionScope']; edit(decisionScope === 'moderation' ? { decisionScope, votingMethod: 'one_member_one_vote', executionMode: 'advisory' } : { decisionScope }); }}>{Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UiSelect></label>
        <label className="community-governance-create-controls__field"><span>投票方式</span><UiSelect aria-label="投票方式" value={draft.votingMethod} disabled={locked || policy} onChange={event => edit({ votingMethod: event.target.value as Draft['votingMethod'] })}>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UiSelect></label>
        <label className="community-governance-create-controls__field"><span>可決後の効果</span><UiSelect aria-label="可決後の効果" value={draft.executionMode} disabled={locked || policy} onChange={event => edit({ executionMode: event.target.value as Draft['executionMode'] })}>{Object.entries(effects).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UiSelect></label>
        {draft.kind === 'guide' && <label className="community-governance-create-controls__field"><span>参照する編集提案</span><UiSelect aria-label="参照する編集提案" disabled={locked} value={draft.linkedGuideProposalId} onChange={event => edit({ linkedGuideProposalId: event.target.value })}><option value="">編集提案を選択</option>{guideProposals.map(guide => <option key={guide.id} value={guide.id}>{guide.title}</option>)}</UiSelect></label>}
        <label className="community-governance-create-controls__field"><span>タイトル</span><UiInput aria-label="タイトル" maxLength={120} value={draft.title} disabled={locked} onChange={event => edit({ title: event.target.value })} /></label><label className="community-governance-create-controls__field"><span>提案内容</span><UiTextarea aria-label="提案内容" maxLength={4000} value={draft.body} disabled={locked} onChange={event => edit({ body: event.target.value })} /></label><UiButton type="submit" size="compact" disabled={locked}>提案内容を確認</UiButton>
      </form>}
    </> : !loading && <UiButton type="button" size="compact" disabled={!valid() || busy} onClick={() => void load(Boolean(attempt?.conflict))}>提案の設定を再読み込み</UiButton>}
    {error && <p role="alert">{saved ? '提案は保存済みです。' : ''}{error}</p>}{error && !saved && data && <UiButton type="button" size="compact" disabled={busy || loading} onClick={() => void load(Boolean(attempt?.conflict))}>提案の設定を再読み込み</UiButton>}{onClose && <UiButton type="button" size="compact" disabled={busy} onClick={onClose}>閉じる</UiButton>}
  </section>;
}
