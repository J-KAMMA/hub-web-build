"use client";

import { FormEvent, useEffect, useState } from "react";

type Operation = {
  id: string;
  threadId: string;
  title: string;
  action: string;
  detail: string;
  createdAt: string;
};

type Signal = {
  threadId: string;
  postId: string;
  postNo: number;
  title: string;
  votes?: number;
  total?: number;
  reason?: string;
};

type Receipt = {
  auditId: string;
  action: string;
  targetId: string;
  confirmedAt: string;
  replayed?: boolean;
};

function undoImpact(action: string) {
  if (action === "move") return "スレッドを移動前のカテゴリへ戻します。";
  if (action === "freeze") return "スレッドの凍結を解除し、再び投稿できる状態へ戻します。";
  if (action === "unfreeze") return "スレッドを再び凍結状態へ戻します。";
  if (action === "merge") return "統合を解除し、統合元スレッドの以前の状態を復元します。";
  return "選択した運営操作を、記録されている直前の状態へ戻します。";
}

export function ThreadOperationHistory() {
  const [items, setItems] = useState<Operation[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [message, setMessage] = useState("読み込み中…");
  const [pending, setPending] = useState<Operation | null>(null);
  const [note, setNote] = useState("");
  const [operationId, setOperationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  async function load() {
    const [response, risk] = await Promise.all([
      fetch("/api/admin/moderation/threads", { cache: "no-store" }),
      fetch("/api/admin/moderation/thread-signals", { cache: "no-store" })
    ]);
    if (!response.ok) {
      setMessage("管理画面で認証してから開いてください。");
      return;
    }
    const payload = (await response.json()) as { operations?: Operation[] };
    setItems(payload.operations ?? []);
    if (risk.ok) {
      const value = (await risk.json()) as {
        bursts?: Signal[];
        reasons?: Signal[];
        reports?: Signal[];
        corrections?: Signal[];
      };
      setSignals([
        ...(value.bursts ?? []),
        ...(value.reasons ?? []),
        ...(value.reports ?? []),
        ...(value.corrections ?? [])
      ]);
    }
    setMessage("");
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!pending) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setPending(null);
        setNote("");
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [pending, busy]);

  function requestUndo(item: Operation) {
    setPending(item);
    setNote("");
    setOperationId(crypto.randomUUID());
    setMessage("");
    setReceipt(null);
  }

  async function confirmUndo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || note.trim().length < 5 || !operationId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/moderation/threads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          requestId: pending.id,
          note: note.trim(),
          operationId
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        receipt?: Receipt;
      };
      if (!response.ok) throw new Error(payload.error ?? "操作を戻せませんでした。");
      setReceipt(payload.receipt ?? null);
      setMessage(payload.receipt?.replayed
        ? "同じ取消要求の再送を検出し、重複処理を防止しました。"
        : "操作を元に戻しました。");
      setPending(null);
      setNote("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作を戻せませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="moderation-operation-page">
    <header>
      <div>
        <h1>スレッド監視・操作履歴</h1>
        <p>投票急増、低評価理由、通報集中、訂正の多いスレッドを確認できます。</p>
      </div>
      <a href="/admin/moderation">通報管理へ戻る</a>
    </header>

    {message && <p role="status">{message}</p>}
    {receipt && <aside className="moderation-operation-receipt" role="status">
      <strong>取消が確定しました</strong>
      <span>{receipt.action} · {receipt.targetId}</span>
      <code>監査番号 {receipt.auditId}</code>
      <time dateTime={receipt.confirmedAt}>
        {new Date(receipt.confirmedAt).toLocaleString("ja-JP")}
      </time>
      {receipt.replayed && <span>同じ取消要求の再送を検出し、重複処理を防止しました。</span>}
    </aside>}

    {pending && <div className="moderation-operation-backdrop">
      <form
        className="moderation-operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-undo-title"
        onSubmit={confirmUndo}
      >
        <small>操作の取消確認</small>
        <h2 id="thread-undo-title">「{pending.title}」の操作を元に戻す</h2>
        <p>{undoImpact(pending.action)}</p>
        <dl>
          <div><dt>対象</dt><dd>{pending.title}</dd></div>
          <div><dt>元の操作</dt><dd>{pending.action}</dd></div>
          <div><dt>実行日時</dt><dd>{new Date(pending.createdAt).toLocaleString("ja-JP")}</dd></div>
        </dl>
        <label htmlFor="thread-undo-note">取消理由
          <textarea
            id="thread-undo-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            minLength={5}
            maxLength={1000}
            autoFocus
            required
            placeholder="確認した事実と取消理由を5文字以上で記入"
          />
        </label>
        <p className="moderation-operation-notice">
          取消も新しい運営操作として監査記録へ保存されます。
        </p>
        <div>
          <button type="button" disabled={busy} onClick={() => {
            setPending(null);
            setNote("");
          }}>キャンセル</button>
          <button type="submit" disabled={busy || note.trim().length < 5}>
            {busy ? "処理中…" : "この操作を元に戻す"}
          </button>
        </div>
      </form>
    </div>}

    <section>
      <h2>品質・荒らしシグナル</h2>
      <div>{signals.map((item, index) => <article key={`${item.postId}:${item.reason ?? index}`}>
        <a href={`/threads/${item.threadId}#post-${item.postNo}`}>
          {item.title}・レス {item.postNo}
        </a>
        <span>{item.reason ?? (item.votes ? `1時間に${item.votes}票` : `${item.total ?? 0}件`)}</span>
      </article>)}</div>
    </section>

    <section>
      <h2>操作履歴</h2>
      <div>{items.map((item) => <article key={item.id}>
        <a href={`/threads/${item.threadId}`}>{item.title}</a>
        <span>{item.action}・{new Date(item.createdAt).toLocaleString("ja-JP")}</span>
        {item.detail && <p>{item.detail}</p>}
        <button type="button" onClick={() => requestUndo(item)}>元に戻す</button>
      </article>)}</div>
    </section>
  </section>;
}
