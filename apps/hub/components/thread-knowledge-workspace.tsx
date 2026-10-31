"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Summary = { id: string; revision_no: number; body: string; status: string };
type Knowledge = { summaries: Summary[]; topics: { kind: string; value: string; following: boolean }[]; continuation: { id: string; title: string }[]; archived: boolean; canManage: boolean; canPropose: boolean; authenticated: boolean; canContinue: boolean; summaryPage?: { before: number | null; hasMore: boolean; nextBefore: number | null } };
const labels: Record<string, string> = { board: "掲示板", tag: "タグ", language: "言語", region: "地域" };
type Props = { threadId: string; canManage: boolean; postCount: number; boardKey?: string; language?: string; region?: string; tags?: string[] };
export function ThreadKnowledgeWorkspace({ threadId }: Props) {
  const [data, setData] = useState<Knowledge | null>(null), [text, setText] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const router = useRouter(), [nextTitle, setNextTitle] = useState(""), [nextText, setNextText] = useState(""), [anonymous, setAnonymous] = useState(false);
  const continuationRequest = useRef<{ key: string; id: string } | null>(null);
  const working = useRef(false), request = useRef<{ text: string; id: string } | null>(null), current = useRef(threadId); current.current = threadId;
  const before = useRef<number | null>(null), pageCursors = useRef<(number | null)[]>([]);
  const load = async (cursor = before.current, onLoaded?: () => void) => {
    const query = cursor === null ? "" : `?before=${cursor}`;
    const response = await fetch(`/api/bbs/threads/${threadId}/knowledge-platform${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "共同まとめを読み込めませんでした。");
    if (!Array.isArray(payload.summaries) || !Array.isArray(payload.topics) || !Array.isArray(payload.continuation)) throw new Error("共同まとめを確認できませんでした。");
    if (current.current === threadId) { onLoaded?.(); before.current = cursor; setData(payload); }
  };
  useEffect(() => {
    setData(null); setText(""); setMessage(""); request.current = null;
    setNextTitle(""); setNextText(""); setAnonymous(false); continuationRequest.current = null;
    before.current = null; pageCursors.current = [];
    void load().catch(error => { if (current.current === threadId) setMessage(String(error.message)); });
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (action: string, extra: Record<string, unknown>, check: (payload: Record<string, unknown>) => boolean) => {
    if (working.current) return; working.current = true; setBusy(true); setMessage("更新中…");
    try {
      const response = await fetch(`/api/bbs/threads/${threadId}/knowledge-platform`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "更新できませんでした。");
      if (!check(payload)) throw new Error("保存結果を確認できませんでした。入力は保持しています。");
      if (current.current !== threadId) return;
      if (action === "propose_summary") { setText(""); request.current = null; before.current = null; pageCursors.current = []; }
      if (action === "continue_thread") { router.push(`/threads/${encodeURIComponent((payload.thread as { id: string }).id)}`); return; }
      await load(); setMessage("更新しました。");
    } catch (error) { if (current.current === threadId) setMessage(error instanceof Error ? error.message : "更新できませんでした。"); }
    finally { working.current = false; setBusy(false); }
  };
  const changePage = async (older: boolean) => {
    const cursor = older ? data?.summaryPage?.nextBefore : pageCursors.current.at(-1);
    if (working.current || cursor === undefined || (older && cursor === null)) return;
    working.current = true; setBusy(true); setMessage("読み込み中…");
    try { await load(cursor, () => { if (older) pageCursors.current.push(before.current); else pageCursors.current.pop(); }); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "提案を読み込めませんでした。"); }
    finally { working.current = false; setBusy(false); }
  };
  const propose = () => {
    const value = text.trim();
    if ([...value].length < 20 || value.length > 12000) { setMessage("まとめは20〜12000文字で入力してください。"); return; }
    if (request.current?.text !== value) request.current = { text: value, id: crypto.randomUUID() };
    const id = request.current.id;
    void act("propose_summary", { text: value, requestId: id }, payload => payload.saved === true && payload.summaryId === id);
  };
  const published = data?.summaries.find(item => item.status === "published");
  const continueThread = () => {
    const input = { title: nextTitle.trim(), text: nextText.trim(), identityMode: anonymous ? "anonymous" : "account" };
    if (input.title.length < 8 || input.title.length > 100 || input.text.length < 30 || input.text.length > 4000) { setMessage("タイトルは8〜100文字、本文は30〜4000文字で入力してください。"); return; }
    const key = JSON.stringify(input); if (continuationRequest.current?.key !== key) continuationRequest.current = { key, id: crypto.randomUUID() };
    const id = continuationRequest.current.id;
    void act("continue_thread", { ...input, requestId: id }, payload => (payload.thread as { id?: string } | undefined)?.id === id);
  };
  return <details className="thread-knowledge-workspace">
    <summary><strong>共同まとめ・話題フォロー</strong>{published && <span>公開版 v{published.revision_no}</span>}</summary>
    <div className="thread-knowledge-workspace__body">
      {published ? <article><p>{published.body}</p></article> : data && <p>公開されたまとめはまだありません。</p>}
      {data?.canPropose && <form onSubmit={event => { event.preventDefault(); propose(); }}>
        <textarea aria-label="まとめの提案" value={text} maxLength={12000} disabled={busy} onChange={event => setText(event.target.value)} placeholder="要点、回答、異なる見方、訂正・出典を整理（20文字以上）" />
        <button disabled={busy} type="submit">まとめを提案</button><small>提案は作成者の承認後に公開されます。</small>
      </form>}
      {data && !data.canPropose && <p>{data.authenticated ? "このスレッドのまとめは変更できません。" : "提案・フォローにはログインが必要です。"}</p>}
      {data?.summaries.filter(item => item.status !== "published").map(item => <article key={item.id}><small>{item.status === "proposed" ? "提案" : item.status === "rejected" ? "却下された提案" : "過去版"} v{item.revision_no}</small><p>{item.body}</p>
        {data.canManage && item.status === "proposed" && <button disabled={busy} onClick={() => { if (window.confirm("この提案を公開版にしますか？ 現在の公開版を置き換えます。")) void act("publish_summary", { summaryId: item.id }, payload => payload.published === true && payload.summaryId === item.id); }}>この提案を公開</button>}
      </article>)}
      {(data?.summaryPage?.hasMore || pageCursors.current.length > 0) && <nav aria-label="共同まとめの提案ページ"><button disabled={busy || !pageCursors.current.length} onClick={() => void changePage(false)}>新しい20件</button><button disabled={busy || !data?.summaryPage?.hasMore} onClick={() => void changePage(true)}>古い20件</button></nav>}
      {data?.authenticated && <><div>{data.topics.map(topic => <button key={`${topic.kind}:${topic.value}`} disabled={busy} onClick={() => void act(topic.following ? "unsubscribe" : "subscribe", topic, payload => payload.subscribed === !topic.following)}>{labels[topic.kind]} {topic.value} {topic.following ? "フォロー解除" : "フォロー"}</button>)}</div>
        <button disabled={busy} onClick={() => void act(data.archived ? "unarchive" : "archive", {}, payload => payload.archived === !data.archived)}>{data.archived ? "あとで読むから外す" : "あとで読むに保存"}</button></>}
      {data?.continuation.map(item => <a key={item.id} href={`/threads/${encodeURIComponent(item.id)}`}>{item.title || "続きのスレッド"}</a>)}
      {data?.canContinue && data.authenticated && <details><summary>次スレッドを作る</summary><form onSubmit={event => { event.preventDefault(); continueThread(); }}>
        <input aria-label="次スレッドのタイトル" maxLength={100} value={nextTitle} disabled={busy} onChange={event => setNextTitle(event.target.value)} placeholder="次スレッドのタイトル（8文字以上）" />
        <textarea aria-label="次スレッドの本文" maxLength={4000} value={nextText} disabled={busy} onChange={event => setNextText(event.target.value)} placeholder="背景・引き継ぎ内容（30文字以上）" />
        <label><input type="checkbox" checked={anonymous} disabled={busy} onChange={event => setAnonymous(event.target.checked)} />匿名で投稿</label>
        <p>掲示板・言語・地域・投稿範囲を引き継ぎ、前スレッドからリンクします。</p><button disabled={busy} type="submit">次スレッドを作成</button>
      </form></details>}
      {message && <p role="status">{message}</p>}
      {!data && <button onClick={() => void load().catch(error => setMessage(String(error.message)))}>再読み込み</button>}
    </div>
  </details>;
}
