'use client';

import React, { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { UiButton, UiField, UiInput, UiSelect } from '@/components/ui/primitives';
import { RESEARCH_LINK_KINDS, researchLinkLabels, researchLinkPurposes, type ResearchLink, type ResearchLinkKind } from '@/lib/research-workspace';

export function ResearchLinkPicker({ endpoint, links, disabled, onAdd }: {
  endpoint: string;
  links: ResearchLink[];
  disabled: boolean;
  onAdd: (link: ResearchLink) => Promise<boolean>;
}) {
  const hintId = useId();
  const [kind, setKind] = useState<ResearchLinkKind>('article');
  const [query, setQuery] = useState('');
  const [request, setRequest] = useState<{ kind: ResearchLinkKind; query: string } | null>(null);
  const [results, setResults] = useState<ResearchLink[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);

  function invalidate() {
    controller.current?.abort();
    setRequest(null); setResults(null); setError(''); setNotice(''); setLoading(false);
  }
  useEffect(() => {
    setResults(null); setError(''); setNotice('');
    if (!request) return;
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    const params = new URLSearchParams({ linkKind: request.kind, q: request.query });
    void fetch(`${endpoint}?${params}`, { signal: AbortSignal.any([current.signal, AbortSignal.timeout(20000)]) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '検索できませんでした。');
        if (!current.signal.aborted) setResults(data.links);
      })
      .catch(cause => {
        if (!current.signal.aborted) setError(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : '検索が時間内に終わりませんでした。もう一度検索してください。');
      })
      .finally(() => { if (!current.signal.aborted) setLoading(false); });
    return () => current.abort();
  }, [endpoint, request]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    controller.current?.abort();
    setRequest({ kind, query: query.trim() });
  }
  return <div className="research-link-picker">
    <form onSubmit={search}>
      <UiField label="検索する種類"><UiSelect value={kind} onChange={event => { invalidate(); setKind(event.target.value as ResearchLinkKind); }}>
        {RESEARCH_LINK_KINDS.map(value => <option key={value} value={value}>{researchLinkLabels[value]}</option>)}
      </UiSelect></UiField>
      <UiField label="関連先を検索">
        <UiInput type="search" aria-label="関連先を検索" aria-describedby={hintId} value={query} maxLength={100} placeholder="タイトル・キーワード" onChange={event => { invalidate(); setQuery(event.target.value); }}/>
      </UiField>
      <UiButton type="submit" disabled={disabled} pending={loading} pendingLabel="検索中…" size="compact">検索</UiButton>
    </form>
    <p className="research-link-hint research-link-purpose">{researchLinkLabels[kind]} · {researchLinkPurposes[kind]}の関連先を探せます。</p>
    <p id={hintId} className="research-link-hint">このHubの公開コンテンツから選べます。検索語を空にすると一覧を表示します。</p>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">関連先を検索しています…</p> : null}
    {results ? <>
      <p role="status">{results.length ? `${results.length}件を表示しています。最大20件。検索語で絞り込めます。` : '一致する公開コンテンツはありません。種類や検索語を変えてください。'}</p>
      <ul className="research-link-results" aria-label="関連先の検索結果">{results.map(link => {
        const added = links.some(item => item.kind === link.kind && item.targetId === link.targetId);
        return <li key={`${link.kind}:${link.targetId}`}>
          <div><a href={link.href} target="_blank" rel="noopener noreferrer">{link.title}</a><span>{researchLinkLabels[link.kind]} · 別タブで確認</span></div>
          <UiButton type="button" size="compact" disabled={disabled || added} aria-label={`${added ? '追加済み' : '追加'}: ${link.title}`} onClick={() => {
            setNotice('');
            void onAdd(link).then(saved => { if (saved) setNotice(`${link.title}を関連付けました。`); });
          }}>{added ? '追加済み' : '追加'}</UiButton>
        </li>;
      })}</ul>
    </> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </div>;
}
