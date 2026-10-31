"use client";

import { useEffect, useState } from "react";

type ImageItem = {
  id: string;
  threadId: string;
  postNo: number;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  createdAt: string;
};

type Receipt = {
  auditId: string;
  action: string;
  targetId: string;
  confirmedAt: string;
  replayed: boolean;
  storageDeletionPending?: boolean;
};

export function ThreadImageModeration() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [message, setMessage] = useState("読み込み中…");
  const [pending, setPending] = useState<ImageItem | null>(null);
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  async function load() {
    const response = await fetch("/api/admin/moderation/thread-images", { cache: "no-store" });
    if (!response.ok) {
      setMessage("管理画面で認証してから開いてください。");
      return;
    }
    const payload = (await response.json()) as { images: ImageItem[] };
    setItems(payload.images);
    setMessage(payload.images.length ? "" : "添付画像はありません。");
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!pending) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setPending(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, pending]);

  function requestRemoval(item: ImageItem) {
    setPending(item);
    setReason("");
    setOperationId(crypto.randomUUID());
    setReceipt(null);
  }

  async function confirmRemoval() {
    if (!pending || reason.trim().length < 5 || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/moderation/thread-images", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: pending.id,
          note: reason.trim(),
          operationId
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; receipt?: Receipt }
        | null;
      if (!response.ok || !payload?.receipt) {
        setMessage(payload?.error ?? "画像を非公開にできませんでした。");
        return;
      }
      setItems((current) => current.filter((item) => item.id !== pending.id));
      setReceipt(payload.receipt);
      setPending(null);
      setMessage(
        payload.receipt.storageDeletionPending
          ? "公開を停止しました。保存画像の削除は再試行待ちです。"
          : "公開を停止し、保存画像を削除しました。"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="moderation-image-page">
      <header>
        <div>
          <h1>スレッド添付画像</h1>
          <p>公開中の添付を確認し、問題のある画像の公開停止と保存画像の削除を行います。</p>
        </div>
        <a href="/admin/moderation">通報管理へ戻る</a>
      </header>

      {message && <p role="status">{message}</p>}
      {receipt && (
        <section className="moderation-operation-receipt" aria-label="操作レシート">
          <strong>操作を記録しました</strong>
          <span>監査番号: {receipt.auditId}</span>
          <span>対象画像: {receipt.targetId}</span>
          <span>実行日時: {new Date(receipt.confirmedAt).toLocaleString("ja-JP")}</span>
          {receipt.replayed && <span>同じ操作IDの結果を再表示しています。</span>}
          {receipt.storageDeletionPending && (
            <span>公開は停止済みです。保存画像の削除は再試行が必要です。</span>
          )}
        </section>
      )}

      <div className="moderation-image-grid">
        {items.map((item) => (
          <article key={item.id}>
            <a href={`/threads/${item.threadId}?page=${Math.ceil(item.postNo / 50)}#post-${item.postNo}`}>
              <img src={`/api/media/images/${item.id}`} alt={item.altText} />
            </a>
            <small>
              スレッド {item.threadId}・投稿 #{item.postNo}
            </small>
            <small>
              {item.width}×{item.height}・{Math.ceil(item.byteSize / 1024)}KB
            </small>
            <button type="button" onClick={() => requestRemoval(item)}>
              公開停止と削除
            </button>
          </article>
        ))}
      </div>

      {pending && (
        <div className="moderation-operation-backdrop">
          <section
            className="moderation-operation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-removal-title"
          >
            <h2 id="image-removal-title">画像の公開停止と削除</h2>
            <dl>
              <div>
                <dt>対象</dt>
                <dd>
                  スレッド {pending.threadId}・投稿 #{pending.postNo}・画像 {pending.id}
                </dd>
              </div>
              <div>
                <dt>影響</dt>
                <dd>
                  画像は直ちに非公開になり、保存画像とサムネイルも削除されます。削除後は元に戻せません。
                </dd>
              </div>
            </dl>
            <label>
              判断理由（5文字以上）
              <textarea
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                placeholder="違反内容や判断根拠を記録"
              />
            </label>
            <div>
              <button type="button" disabled={busy} onClick={() => setPending(null)}>
                キャンセル
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy || reason.trim().length < 5}
                onClick={() => void confirmRemoval()}
              >
                {busy ? "処理中…" : "公開停止して削除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
