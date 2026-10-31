"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ThreadAuthorControl } from "./thread-author-control";

const REPORT_REASONS = [
  ["harassment", "嫌がらせ・攻撃"],
  ["spam", "スパム・宣伝"],
  ["privacy", "個人情報・プライバシー"],
  ["misinformation", "危険な誤情報"],
  ["other", "その他"],
] as const;

interface Props {
  threadId: string;
  postId: string;
  postNo: number;
  authenticated: boolean;
  viewerIsAuthor: boolean;
  canControlAuthor: boolean;
  muted: boolean;
  deleted: boolean;
}

export function ThreadPostNumberMenu({
  threadId,
  postId,
  postNo,
  authenticated,
  viewerIsAuthor,
  canControlAuthor,
  muted,
  deleted,
}: Props) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isPending, startTransition] = useTransition();
  const [showReport, setShowReport] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number][0]>("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [message, setMessage] = useState("");

  const close = () => detailsRef.current?.removeAttribute("open");

  const copyLink = async () => {
    const link = `${window.location.origin}/threads/${threadId}#post-${postNo}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("リンクをコピーしました。");
    } catch {
      setMessage("リンクをコピーできませんでした。");
    }
  };

  const submitReport = () => {
    setMessage("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/bbs/thread-posts/${postId}/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, details: reportDetails.trim() }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setMessage(payload.error ?? "通報を送信できませんでした。");
          return;
        }
        setShowReport(false);
        setReportDetails("");
        setMessage("通報を受け付けました。");
      } catch {
        setMessage("通報を送信できませんでした。");
      }
    });
  };

  return (
    <details ref={detailsRef} className="thread-post-number-menu">
      <summary className="bbs-post__no thread-post-card__number" aria-label={`レス ${postNo} のメニュー`}>
        {postNo}
      </summary>
      <div className="thread-post-number-menu__popover">
        <a href={`#post-${postNo}`} onClick={close}>このレスを表示</a>
        <button type="button" onClick={copyLink}>リンクをコピー</button>
        {authenticated && !viewerIsAuthor && !deleted && (
          <button type="button" onClick={() => setShowReport((current) => !current)}>通報</button>
        )}
        {authenticated && canControlAuthor && !deleted && (
          <ThreadAuthorControl postId={postId} kinds={["mute"]} disabled={isPending} />
        )}
        {showReport && (
          <div className="thread-post-number-menu__report">
            <label>
              理由
              <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
                {REPORT_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <textarea
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
              maxLength={500}
              placeholder="必要なら状況を補足してください"
            />
            <button type="button" onClick={submitReport} disabled={isPending}>通報を送信</button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
