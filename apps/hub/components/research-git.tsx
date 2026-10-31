'use client';
import React, { useEffect, useRef, useState } from 'react';
import { UiButton, UiField, UiInput, UiSelect } from '@/components/ui/primitives';
import { parseResearchGitManagementInfo, parseResearchGitManagementResult, type ResearchGitManagementInfo, type ResearchGitManagementInput } from '@/lib/research-git-management';
import { ResearchGitBrowser } from './research-git-browser';
import { researchGitBundleUrl } from '@/lib/research-git-portability';
import { ResearchGitProposals } from './research-git-proposals';
import type {ResearchGitCommitDetail} from '@/lib/research-git-browse';
import {ResearchGitBundleTransfer} from './research-git-bundle-transfer';

type Props = { projectId: string; canEdit: boolean; signedIn?: boolean; actorId?: string; initialCommit?: string; initialBase?: string; initialGitProposal?: string; projectPublic?: boolean };
type Selection = { action: 'create' } | { action: 'visibility'; visibility: 'public' | 'confidential' } | { action: 'token'; scope: 'read' | 'write' } | { action: 'revoke'; id: string };
type Attempt = { body: ResearchGitManagementInput; preview?: ResearchGitManagementInfo; sent: boolean; uncertain: boolean; rejected: boolean; current?: ResearchGitManagementInfo };
type Saved = { action: Selection['action']; replayed: boolean; active?: boolean; id?: string; scope?: 'read' | 'write'; expiresAt?: string; lost: boolean };
const label = (body: Selection) => body.action === 'create' ? '非公開リポジトリを作成' : body.action === 'token' ? '認証情報を発行' : body.action === 'revoke' ? '認証情報を無効化' : body.visibility === 'public' ? '全履歴を公開' : 'リポジトリを非公開に変更';

export function ResearchGit(props: Props) {
  return <GitManagement key={JSON.stringify([props.projectId, props.actorId ?? null, props.signedIn ?? false, props.canEdit])} {...props} />;
}
function GitManagement({ projectId, canEdit, signedIn = false, actorId, initialCommit = '', initialBase = '', initialGitProposal = '', projectPublic = false }: Props) {
  const [comparison,setComparison]=useState<ResearchGitCommitDetail|null>(null);
  const endpoint = `/api/research/projects/${encodeURIComponent(projectId)}/git`;
  const [data, setData] = useState<ResearchGitManagementInfo | null>(null), [scope, setScope] = useState<'read' | 'write'>('read'), [attempt, setAttempt] = useState<Attempt | null>(null), [saved, setSaved] = useState<Saved | null>(null);
  const [credential, setCredential] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [readReady, setReadReady] = useState(false), [invalidated, setInvalidated] = useState(false), [issuanceToRevoke, setIssuanceToRevoke] = useState<string | null>(null);
  const mounted = useRef(false), epoch = useRef(0), reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null), sending = useRef(false), held = useRef<Attempt | null>(null), viewer = useRef<string | null | undefined>(actorId);
  const valid = (g: number) => mounted.current && epoch.current === g;
  function purgeReader() { setData(null); setReadReady(false); setCredential(''); if (held.current) { delete held.current.preview; delete held.current.current; setAttempt({ ...held.current }); } }
  function invalidate() { epoch.current++; reading.current?.abort(); writing.current?.abort(); held.current = null; sending.current = false; purgeReader(); setAttempt(null); setSaved(null); setIssuanceToRevoke(null); setBusy(false); setLoading(false); setInvalidated(true); setError('アカウントが変わりました。Git管理画面を閉じて開き直してください。'); }
  async function load(): Promise<ResearchGitManagementInfo | undefined> {
    if (!mounted.current || sending.current || invalidated) return;
    const g = epoch.current, controller = new AbortController(); reading.current?.abort(); reading.current = controller; if (held.current) { delete held.current.current; setAttempt({ ...held.current }); } setLoading(true); setReadReady(false); setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }), value: unknown = await response.json().catch(() => null);
      if (!valid(g) || controller.signal.aborted || reading.current !== controller) return;
      if (!response.ok) { if ([401, 403, 404].includes(response.status)) purgeReader(); throw Error(message(value, 'Git管理情報を取得できませんでした。')); }
      let next: ResearchGitManagementInfo; try { next = parseResearchGitManagementInfo(value, projectId); } catch (cause) { purgeReader(); throw cause; }
      if (viewer.current !== undefined && next.viewerId !== viewer.current) { invalidate(); return; } viewer.current = next.viewerId;
      if (!next.canManage) { setCredential(''); if (held.current) { delete held.current.preview; setAttempt({ ...held.current }); } }
      setData(next); setReadReady(true); return next;
    } catch (cause) { if (valid(g) && !controller.signal.aborted && reading.current === controller) setError(cause instanceof Error ? cause.message : 'Git管理情報を取得できませんでした。'); }
    finally { if (valid(g) && !controller.signal.aborted && reading.current === controller) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; window.addEventListener('hub-account-changed', invalidate); void load(); return () => { mounted.current = false; epoch.current++; reading.current?.abort(); writing.current?.abort(); held.current = null; window.removeEventListener('hub-account-changed', invalidate); }; }, [endpoint]);
  async function prepare(selection: Selection) {
    if (held.current || saved || loading || sending.current || !readReady || !canEdit) return;
    setCredential(''); const next = await load(); if (!next || !next.canManage || !next.viewerId || held.current || !mounted.current) return;
    if (selection.action === 'token' && issuanceToRevoke && next.tokens.some(t => t.id === issuanceToRevoke)) { setError('認証情報を受け取れなかった発行記録を先に無効化してください。'); return; }
    if (selection.action === 'create' ? next.repository !== null : !next.repository || (selection.action === 'revoke' && !next.tokens.some(t => t.id === selection.id))) { setError('現在の状態が変わりました。操作を選び直してください。'); return; }
    const body = { ...selection, snapshot: next.snapshot, ...(selection.action === 'token' ? { requestId: crypto.randomUUID() } : {}) } as ResearchGitManagementInput;
    held.current = { body, preview: next, sent: false, uncertain: false, rejected: false }; setAttempt(held.current);
  }
  async function save() {
    const current = held.current;
    if (!current || sending.current || loading || !readReady || !data?.canManage || !canEdit || invalidated || saved || current.rejected || (current.sent && current.body.action !== 'token')) return;
    const g = epoch.current, controller = new AbortController(); writing.current = controller; sending.current = true; current.sent = true; current.uncertain = true; setBusy(true); setError(''); setAttempt({ ...current });
    try {
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), body: JSON.stringify(current.body) }), value: unknown = await response.json().catch(() => null);
      if (!valid(g) || controller.signal.aborted || held.current !== current) return;
      if (!response.ok) { if ([400, 401, 403, 404, 409, 413].includes(response.status)) current.rejected = true; if ([401, 403, 404].includes(response.status)) purgeReader(); throw Error(message(value, '保存結果を確認できませんでした。')); }
      const result = parseResearchGitManagementResult(value, projectId, current.body);
      if (result.data.viewerId !== viewer.current) { invalidate(); return; }
      setData(result.data); setReadReady(true); setCredential(result.token ?? '');
      setSaved({ action: result.action, replayed: result.replayed, id: result.id, scope: result.scope, expiresAt: result.expiresAt, active: result.active, lost: result.action === 'token' && !result.token });
      if (result.action === 'token' && !result.token && result.active && result.id) setIssuanceToRevoke(result.id);
      setError('');
    } catch (cause) { if (valid(g) && held.current === current && !controller.signal.aborted) { setAttempt({ ...current }); setError(cause instanceof Error ? cause.message : '保存結果は不明です。同じ発行操作で確認してください。'); } }
    finally { if (valid(g) && held.current === current) { sending.current = false; setBusy(false); } }
  }
  async function inspect() { const current = held.current; const next = await load(); if (next && held.current === current && current) { current.current = next; setAttempt({ ...current }); } }
  function closeOperation() {
    const current = held.current; if (!current?.current || loading || busy || (current.body.action === 'token' && !current.rejected && current.current.canManage && canEdit)) return;
    const body = current.body; if (body.action === 'token' && current.current.tokens.some(t => t.id === body.requestId)) setIssuanceToRevoke(body.requestId);
    held.current = null; setAttempt(null); setError('以前の保存結果は断定せず、確認した現在の状態で操作を閉じました。再送していません。');
  }
  async function nextOperation() { setCredential(''); const next = await load(); if (next) { held.current = null; setAttempt(null); setSaved(null); } }
  const editable = canEdit && data?.canManage && readReady && !invalidated, locked = loading || busy || Boolean(attempt) || Boolean(saved), preview = attempt?.preview;
  const body = attempt?.body, revoked = body?.action === 'revoke' ? preview?.tokens.find(t => t.id === body.id) : undefined;
  const bundleUrl = data && readReady && !invalidated ? researchGitBundleUrl(data) : null;
  return <section className="research-documents research-files" id="git"><h2>Gitリポジトリ</h2>
    {loading && <p role="status">Git管理情報を確認しています…</p>}
    {error && <p role="alert">{saved ? '操作は保存済みです。' : ''}{error}</p>}
    {data && !data.repository && <><p>コードの履歴をHubに保管し、Gitからclone・pushできます。</p>{editable && <UiButton type="button" size="compact" disabled={locked} onClick={() => void prepare({ action: 'create' })}>非公開リポジトリを作成</UiButton>}</>}
    {data?.repository && <><p>{data.repository.visibility === 'public' ? '公開' : '非公開'} · pushは所有者のみ。強制更新とブランチ削除は受け付けません。</p><p>リポジトリの登録状況を表示しています。Gitサーバーへの接続は、clone・fetch・pushで確認してください。</p>
      {data.repository.url ? <UiField label="clone URL"><UiInput readOnly value={data.repository.url} /></UiField> : <p>Gitサーバーの接続先が未設定です。</p>}
      {bundleUrl && <details><summary>別のHubへコードを持ち出す</summary>
        <p>公開中の全ブランチ・タグ・履歴をGit bundleで保存します（最大50MiB）。取得済みの履歴は、元のHubが停止しても復元できます。課題・議論・PDFは含みません。</p>
        <a href={bundleUrl} target="_blank" rel="noreferrer">公開Git履歴をダウンロード</a>
        <p>取得後はGitで復元し、別のHubに作ったリポジトリへpushできます。コードは自動実行しません。</p>
        <pre><code>git clone --mirror PROJECT.bundle restored.git</code></pre>
      </details>}
      <p>Gitの認証画面でユーザー名に「hub」、パスワードに下の認証情報を入力します。認証情報をURLやソースに書かないでください。</p>
      {canEdit && data.canManage && <><details><summary>Git用の認証情報を発行</summary><p>このリポジトリだけに使える、有効期限1時間の認証情報です。</p><UiSelect aria-label="Gitの権限" value={scope} disabled={locked || !readReady} onChange={e => setScope(e.target.value as 'read' | 'write')}><option value="read">clone・fetchのみ</option><option value="write">clone・fetch・push</option></UiSelect><UiButton type="button" size="compact" disabled={locked || !readReady} onClick={() => void prepare({ action: 'token', scope })}>発行する</UiButton>
        {data.tokens.map(item => <p key={item.id}>{item.scope === 'write' ? 'push可' : '読み取りのみ'} · {new Date(item.expiresAt).toLocaleString()}まで <UiButton type="button" size="compact" disabled={locked || !readReady} onClick={() => void prepare({ action: 'revoke', id: item.id })}>無効化</UiButton></p>)}</details>
        <details><summary>リポジトリの公開範囲</summary><p>公開すると全ブランチとGit履歴を取得できます。履歴に秘密や個人情報がないことを確認してください。</p><UiButton type="button" size="compact" disabled={locked || !readReady} onClick={() => void prepare({ action: 'visibility', visibility: data.repository!.visibility === 'public' ? 'confidential' : 'public' })}>{data.repository.visibility === 'public' ? '非公開にする' : '全履歴の公開を確定'}</UiButton></details></>}
      <ResearchGitBrowser key={JSON.stringify([actorId ?? null, invalidated])} projectId={projectId} initialCommit={initialCommit} initialBase={initialBase} signedIn={signedIn} onComparison={setComparison} publicRepository={!invalidated && projectPublic && data.projectPublic && data.repository.visibility === 'public'} />
      <ResearchGitBundleTransfer projectId={projectId} actorId={actorId} signedIn={signedIn&&!invalidated} canManage={canEdit&&data.canManage&&!invalidated} repositoryVisibility={data.repository.visibility} projectPublic={!invalidated&&projectPublic&&data.projectPublic} onImportedComparison={setComparison}/>
      <ResearchGitProposals projectId={projectId} signedIn={signedIn&&!invalidated} comparison={comparison} initialProposal={initialGitProposal}/>
    </>}
    {attempt && !saved && <section aria-label="Git管理操作の確認"><h3>{label(attempt.body)}内容の確認</h3>{preview && <><p>対象：この研究プロジェクトのGitリポジトリ</p><p>現在：{preview.repository ? preview.repository.visibility === 'public' ? '公開' : '非公開' : '未作成'}</p></>}
      {attempt.body.action === 'token' && <><p>権限：{attempt.body.scope === 'write' ? 'clone・fetch・push' : 'clone・fetchのみ'} ／ 有効期限：1時間</p><p>認証情報は今回だけ表示します。画面を離れた場合や発行結果を受け取れなかった場合、同じ内容を再送しても認証情報を復元できません。必要なら発行記録を無効化して、別の発行操作を行ってください。</p></>}
      {attempt.body.action === 'visibility' && <p>{attempt.body.visibility === 'public' ? '全ブランチとGit履歴を公開します。秘密や個人情報を含まないことを確認してください。' : 'Gitリポジトリを非公開に変更します。既に取得された履歴は回収できません。'}</p>}
      {attempt.body.action === 'revoke' && <p>選択した認証情報（{revoked?.scope === 'write' ? 'push可' : '読み取りのみ'}、{revoked && new Date(revoked.expiresAt).toLocaleString()}まで）を無効化します。この認証情報ではclone・fetch・pushできなくなります。</p>}
      {attempt.body.action === 'create' && <p>Gitリポジトリを非公開で作成します。</p>}
      {attempt.sent && <p>{attempt.rejected ? '保存結果の応答は拒否されました。保存されたかは現在の管理情報で確認してください。' : '以前の保存結果は確定できません。'}対象と内容を固定しています。</p>}
      {!attempt.rejected && (!attempt.sent || attempt.body.action === 'token') && <UiButton type="button" size="compact" pending={busy} disabled={loading || !editable} onClick={() => void save()}>{attempt.sent ? '同じ発行の結果を確認' : '確認して保存'}</UiButton>}
      {!attempt.sent && <UiButton type="button" size="compact" disabled={busy || loading} onClick={() => { held.current = null; setAttempt(null); }}>操作の選択に戻る</UiButton>}
      {attempt.sent && <><UiButton type="button" size="compact" disabled={busy || loading || invalidated} onClick={() => void inspect()}>現在の管理情報を確認</UiButton>{attempt.current && <><p>現在の関連情報を読み直しました。以前の保存結果を証明するものではありません。</p>{(attempt.body.action !== 'token' || attempt.rejected || !attempt.current.canManage || !canEdit) && <UiButton type="button" size="compact" disabled={busy || loading} onClick={closeOperation}>現在の状態を確認して操作を閉じる</UiButton>}</>}</>}
    </section>}
    {saved && <section aria-label="Git管理操作の保存結果"><p>操作の保存を確認しました。再適用しません。</p>{saved.action === 'token' && <><p>{saved.scope === 'write' ? 'push可' : '読み取りのみ'} · {saved.expiresAt && new Date(saved.expiresAt).toLocaleString()}まで ／ {saved.active ? '有効' : '無効または期限切れ'}</p>{saved.lost && <p>発行記録は確認できましたが、認証情報は復元できません。必要ならこの記録を無効化して、別の発行操作を行ってください。</p>}</>}
      {credential && <><UiField label="今回の認証情報（一度だけ表示）"><UiInput type="password" readOnly value={credential} autoComplete="off" onFocus={e => e.target.select()} /></UiField><UiButton type="button" size="compact" onClick={() => setCredential('')}>認証情報の表示を閉じる</UiButton></>}
      {saved.replayed && <p>現在の状態を表示しています。保存時の状態へ戻しません。</p>}
      <UiButton type="button" size="compact" disabled={busy || loading || invalidated} onClick={() => void nextOperation()}>最新の管理情報を確認して次の操作へ</UiButton>
    </section>}
    {!loading && <UiButton type="button" size="compact" disabled={busy || invalidated} onClick={() => { setCredential(''); void load(); }}>Git管理情報を再読み込み</UiButton>}
  </section>;
}
function message(value: unknown, fallback: string) { return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fallback; }
