"use client";

import { useCallback, useEffect, useState } from "react";

import { UiButton, UiInput, UiStatePanel, UiTextarea } from "@/components/ui/primitives";

/*
 * 他のハブのコミュニティ。参加の申し込み・一覧・中身・書き込み。
 * 中身に出るのは、持ち主のハブが Announce した発言だけ。自分の書き込みも、持ち主のハブが確認して配り直すまでは出ない。
 * 持ち主のハブのルール（モデレーション・ガバナンス）が優先する。ここにはモデレーターの操作は無い。
 */

type ListItem = { id: string; name: string; host: string; slug: string; summary: string; state: string; address: string };
type Item = {
  id: string; objectType: "Page" | "Note"; title: string | null; body: string; inReplyToItemId: string | null; channelName: string | null;
  authorName: string; authorHandle: string; hostAuthored: boolean; publishedAt: string; own: boolean;
};
type View = { community: ListItem & { channels: Array<{ id: string; name: string }> }; items: Item[] };

const STATE_LABEL: Record<string, string> = {
  pending: "承認待ち（持ち主のハブの判断を待っています）",
  accepted: "参加中",
  rejected: "参加を断られました",
  removed: "このコミュニティから外されました",
  banned: "このコミュニティには参加できません",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "処理できませんでした。");
  return payload as T;
}

export function RemoteCommunities() {
  const [list, setList] = useState<ListItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channelId, setChannelId] = useState("");
  const [replyTo, setReplyTo] = useState<Item | null>(null);

  const loadList = useCallback(async () => {
    try {
      setList((await request<{ communities: ListItem[] }>("/api/federation/groups")).communities);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "一覧を読み込めませんでした。");
      setList([]);
    }
  }, []);

  const loadView = useCallback(async (id: string) => {
    try {
      setView(await request<View>(`/api/federation/groups/${encodeURIComponent(id)}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "コミュニティを読み込めませんでした。");
      setView(null);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selected) void loadView(selected); else setView(null); }, [selected, loadView]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "処理できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const join = () => run(async () => {
    const result = await request<{ remoteCommunityId: string; state: string }>("/api/federation/groups", { method: "POST", body: JSON.stringify({ handle: address }) });
    setAddress("");
    setNotice(result.state === "accepted" ? "参加しました。" : "参加を申し込みました。持ち主のハブが承認すると書き込めます。");
    await loadList();
    setSelected(result.remoteCommunityId);
  });

  const leave = () => run(async () => {
    if (!selected) return;
    await request(`/api/federation/groups/${encodeURIComponent(selected)}`, { method: "DELETE" });
    setSelected(null);
    await loadList();
  });

  const send = () => run(async () => {
    if (!selected) return;
    await request(`/api/federation/groups/${encodeURIComponent(selected)}/posts`, {
      method: "POST",
      body: JSON.stringify({ body, title, replyToItemId: replyTo?.id ?? null, channelId: replyTo ? null : channelId || null }),
    });
    setBody("");
    setTitle("");
    setReplyTo(null);
    setNotice("送りました。持ち主のハブが確認すると表示されます（保留や、お断りになることがあります）。");
    await loadView(selected);
  });

  const withdraw = (item: Item) => run(async () => {
    if (!selected) return;
    await request(`/api/federation/groups/${encodeURIComponent(selected)}/posts/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    await loadView(selected);
  });

  const roots = view?.items.filter((item) => !item.inReplyToItemId) ?? [];
  const repliesOf = (id: string) => (view?.items ?? []).filter((item) => item.inReplyToItemId === id).reverse();
  const renderItem = (item: Item, nested = false) => (
    <div key={item.id} className={nested ? "v2-remote__item v2-remote__item--nested" : "v2-remote__item"}>
      {item.title ? <strong>{item.title}</strong> : null}
      <p>{item.body}</p>
      <small className="v2-remote__meta">
        {item.authorName} @{item.authorHandle}{item.hostAuthored ? "（持ち主のハブ）" : ""}
        {item.channelName ? ` · #${item.channelName}` : ""} · {new Date(item.publishedAt).toLocaleString("ja-JP")}
      </small>
      <div className="v2-remote__actions">
        {view?.community.state === "accepted" ? <UiButton size="compact" onClick={() => setReplyTo(item)}>返信</UiButton> : null}
        {item.own ? <UiButton size="compact" tone="danger" disabled={busy} onClick={() => void withdraw(item)}>取り下げる</UiButton> : null}
      </div>
    </div>
  );

  return (
    <div className="v2-remote">
      <section className="v2-remote__section" aria-labelledby="remote-join-title">
        <h2 id="remote-join-title">他のハブのコミュニティに参加する</h2>
        <p>「名前@ホスト」の形で入力します。持ち主のハブが他のハブからの参加を受け付けているコミュニティだけが見つかります。持ち主のハブのルールとモデレーションが優先します。</p>
        <form className="v2-remote__row" onSubmit={(event) => { event.preventDefault(); void join(); }}>
          <UiInput value={address} onChange={(event) => setAddress(event.target.value)} placeholder="general@hub.example.org" aria-label="コミュニティのアドレス" maxLength={320} />
          <UiButton tone="primary" type="submit" pending={busy} disabled={address.trim().length < 3}>参加を申し込む</UiButton>
        </form>
      </section>
      {error ? <p className="v2-remote__alert" role="alert">{error}</p> : null}
      {notice ? <p className="v2-remote__status" role="status">{notice}</p> : null}

      <section className="v2-remote__section" aria-labelledby="remote-list-title">
        <h2 id="remote-list-title">参加しているコミュニティ</h2>
        {list === null ? <UiStatePanel state="loading" title="読み込み中" /> : list.length === 0
          ? <UiStatePanel state="empty" title="まだ参加していません" description="アドレスを入力して参加を申し込みます。" />
          : <ul className="v2-remote__list">{list.map((community) => (
            <li key={community.id}>
              <UiButton size="compact" tone={selected === community.id ? "primary" : "default"} onClick={() => { setSelected(community.id); setNotice(""); }}>
                {community.name}
              </UiButton>
              <small>{community.address} · {STATE_LABEL[community.state] ?? community.state}</small>
            </li>
          ))}</ul>}
      </section>

      {view ? (
        <section className="v2-remote__section" aria-labelledby="remote-view-title">
          <h2 id="remote-view-title">{view.community.name} <small>@{view.community.host}</small></h2>
          <p>{view.community.summary}</p>
          <p><small>{STATE_LABEL[view.community.state] ?? view.community.state}。表示されるのは、持ち主のハブ（{view.community.host}）が配った発言だけです。</small></p>
          {view.community.state === "accepted" ? (
            <form className="v2-remote__form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              {replyTo ? <p>返信先: {replyTo.authorName}「{replyTo.body.slice(0, 40)}」 <UiButton size="compact" type="button" onClick={() => setReplyTo(null)}>やめる</UiButton></p> : (
                <>
                  <UiInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="題名（任意、スレッドになります）" maxLength={100} aria-label="題名" />
                  {view.community.channels.length ? (
                    <select value={channelId} onChange={(event) => setChannelId(event.target.value)} aria-label="チャンネル">
                      <option value="">チャンネルを選ぶ（任意）</option>
                      {view.community.channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                    </select>
                  ) : null}
                </>
              )}
              <UiTextarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1900} rows={3} placeholder="書き込む" aria-label="本文" />
              <div className="v2-remote__actions">
                <UiButton tone="primary" type="submit" pending={busy} disabled={!body.trim() && !title.trim()}>送る</UiButton>
                <UiButton type="button" tone="danger" disabled={busy} onClick={() => void leave()}>退出する</UiButton>
              </div>
            </form>
          ) : <UiButton type="button" disabled={busy} onClick={() => void leave()}>取り消す</UiButton>}
          {view.community.state === "accepted" ? (
            roots.length === 0 ? <UiStatePanel state="empty" title="まだ表示できる発言がありません" />
              : roots.map((item) => (
                <div key={item.id}>
                  {renderItem(item)}
                  {repliesOf(item.id).map((reply) => renderItem(reply, true))}
                </div>
              ))
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
