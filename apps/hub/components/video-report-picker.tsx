"use client";

import { useId, useState, type FormEvent } from "react";

import { VIDEO_REPORT_REASONS, type VideoReportReasonCode } from "@/lib/video-safety";
import "./video-report-picker.css";

/*
 * 動画の通報。理由を7つから選んで送る（POST /api/videos/{id}/engagement, action: report）。
 * 送ったあとに見せるのは「受け付けました」だけ。止めたか、列に並べたかは、通報した人には伝えない。
 */
export function VideoReportPicker({ videoId, authenticated, japanese = true, onDone }: {
  videoId: string;
  authenticated: boolean;
  japanese?: boolean;
  onDone?: () => void;
}) {
  const base = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<VideoReportReasonCode | "">("");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (!authenticated) {
    return <a className="video-report__link" href="/login">{japanese ? "通報（ログインが必要です）" : "Report (sign in)"}</a>;
  }
  if (state === "done") return <p className="video-report__done" role="status">{japanese ? "受け付けました。" : "Received."}</p>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason || state === "sending") return;
    setState("sending");
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/engagement`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "report", reasonCode: reason, reason: detail.trim().slice(0, 200) }),
      });
      if (!response.ok) throw new Error("report_failed");
      setState("done");
      onDone?.();
    } catch {
      setState("error");
    }
  };

  return (
    <div className="video-report">
      <button type="button" className="video-report__toggle" aria-expanded={open} aria-controls={`${base}-form`} onClick={() => setOpen((value) => !value)}>
        {japanese ? "通報" : "Report"}
      </button>
      {open ? (
        <form id={`${base}-form`} className="video-report__form" onSubmit={(event) => void submit(event)}>
          <fieldset className="video-report__reasons">
            <legend>{japanese ? "通報の理由" : "Reason"}</legend>
            {VIDEO_REPORT_REASONS.map((item) => (
              <label key={item.code} className="video-report__reason">
                <input type="radio" name={`${base}-reason`} value={item.code} checked={reason === item.code} onChange={() => setReason(item.code)} />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="video-report__detail">
            <span>{japanese ? "補足（任意）" : "Details (optional)"}</span>
            <textarea maxLength={200} value={detail} onChange={(event) => setDetail(event.target.value)} />
          </label>
          {state === "error" ? <p className="video-report__error" role="alert">{japanese ? "送れませんでした。もう一度お試しください。" : "Could not send."}</p> : null}
          <button type="submit" className="video-report__submit" disabled={!reason || state === "sending"}>{japanese ? "通報する" : "Send report"}</button>
        </form>
      ) : null}
    </div>
  );
}
