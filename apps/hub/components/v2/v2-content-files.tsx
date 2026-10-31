"use client";

import { useCallback, useEffect, useState } from "react";

import { V2ContentDownloadEditor } from "@/components/v2/v2-content-download";
import { contentDownloadNoneNotice, contentDownloadWatermarkNotice } from "@/lib/content-download-policy";

import "./v2-access-gates.css";

/*
 * 閲覧条件つきの投稿・記事に付いたファイル。
 * 一覧（名前・大きさ）もサーバーが閲覧条件を確かめてから返す。鍵が掛かったままなら何も描かない。
 * ダウンロードは押すたびにハブが条件を確かめ直し、一回きりの札つきの URL を返す。
 * ファイルの本体はハブを通らず、ブラウザがファイル部品（/vault/api/files）から直接受け取る。
 * 作者には添付の操作を出す。アップロードもブラウザから部品へ直接送る。
 */

type FileView = { id: string; fileName: string; sizeBytes: number; scanStatus: string | null; state?: string };
type ListResponse = { access?: string; files?: FileView[]; downloadable?: boolean };
type AttachResult = { fileId: string; status: "published" | "not_publishable" | "unavailable"; scanStatus: string | null };

export type V2ContentFilesProps = {
  targetType: "post" | "article";
  targetId: string;
  /** 作者本人のときだけ true。サーバー側でも作者かを確かめる。 */
  canManage?: boolean;
  japanese?: boolean;
};

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${value} B`;
}

function scanLabel(status: string | null, japanese: boolean): string | null {
  if (status === "clean") return null;
  if (status === "pending" || status === "scanning" || status === null) return japanese ? "検査中" : "Scanning";
  return japanese ? "公開できません" : "Not available";
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

export function V2ContentFiles({ targetType, targetId, canManage = false, japanese = true }: V2ContentFilesProps) {
  const [files, setFiles] = useState<FileView[]>([]);
  /* 作者がダウンロードを許可しているか（2026-10-17）。押したときにサーバーがもう一度確かめる。 */
  const [downloadable, setDownloadable] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ targetType, targetId });
      const response = await fetch(`/api/content-files?${query}`, { cache: "no-store" });
      if (!response.ok) return setFiles([]);
      const payload = (await response.json().catch(() => null)) as ListResponse | null;
      setFiles(Array.isArray(payload?.files) ? payload.files : []);
      setDownloadable(payload?.downloadable === true);
    } catch {
      setFiles([]);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (file: FileView) => {
    setMessage("");
    try {
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "file", id: file.id }),
      });
      if (!response.ok) {
        setMessage(await readError(response, japanese ? "ダウンロードできませんでした。" : "Download failed."));
        return;
      }
      const payload = (await response.json().catch(() => null)) as { download?: { url?: unknown } } | null;
      const url = payload?.download?.url;
      // 同じオリジンのファイル部品だけへ移る。
      if (typeof url !== "string" || !url.startsWith("/vault/api/files/")) {
        setMessage(japanese ? "ダウンロードできませんでした。" : "Download failed.");
        return;
      }
      window.location.assign(url);
    } catch {
      setMessage(japanese ? "ダウンロードできませんでした。" : "Download failed.");
    }
  };

  const upload = async (selected: File) => {
    setBusy(true);
    setMessage("");
    try {
      const ticketResponse = await fetch("/api/content-files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: selected.name, sizeBytes: selected.size }),
      });
      if (!ticketResponse.ok) {
        setMessage(await readError(ticketResponse, japanese ? "アップロードを始められませんでした。" : "Could not start the upload."));
        return;
      }
      const { upload: ticket } = (await ticketResponse.json()) as {
        upload: { fileId: string; ticket: string; header: string; path: string };
      };
      if (!ticket.path.startsWith("/vault/api/files/")) throw new Error("unexpected_path");
      const form = new FormData();
      form.append("file", selected);
      const stored = await fetch(ticket.path, { method: "POST", headers: { [ticket.header]: ticket.ticket }, body: form });
      if (stored.status !== 201) {
        setMessage(japanese ? "ファイルを受け付けられませんでした。形式か大きさを確かめてください。" : "The file was not accepted.");
        return;
      }
      const attach = await fetch("/api/content-files/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId, fileIds: [ticket.fileId] }),
      });
      if (!attach.ok) {
        setMessage(await readError(attach, japanese ? "ファイルを添付できませんでした。" : "Could not attach the file."));
        return;
      }
      const result = (await attach.json().catch(() => null)) as { files?: AttachResult[] } | null;
      const status = result?.files?.[0]?.status;
      setMessage(
        status === "published"
          ? japanese ? "添付しました。検査が済むとダウンロードできます。" : "Attached. It can be downloaded after the scan."
          : japanese ? "添付できませんでした。ファイルが検査で止められた可能性があります。" : "The file could not be published.",
      );
      await load();
    } catch {
      setMessage(japanese ? "アップロードできませんでした。" : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: FileView) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/content-files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
      if (!response.ok) setMessage(await readError(response, japanese ? "取り外せませんでした。" : "Could not remove the file."));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!files.length && !canManage) return null;

  return (
    <section className="v2-content-files" aria-label={japanese ? "添付ファイル" : "Attached files"}>
      <h3 className="v2-content-files__title">{japanese ? "添付ファイル" : "Attached files"}</h3>
      {files.length ? (
        <ul className="v2-content-files__list">
          {files.map((file) => {
            const scan = scanLabel(file.scanStatus, japanese);
            const off = file.state && file.state !== "published";
            return (
              <li key={file.id} className="v2-content-files__item">
                <span className="v2-content-files__name">{file.fileName}</span>
                <small className="v2-note">
                  {formatBytes(file.sizeBytes)}
                  {scan ? ` ・ ${scan}` : ""}
                  {off ? (japanese ? " ・ 非公開" : " ・ Unpublished") : ""}
                </small>
                {!off && downloadable ? (
                  <button type="button" className="v2-gate__button" onClick={() => void download(file)} disabled={busy}>
                    {japanese ? "ダウンロード" : "Download"}
                  </button>
                ) : null}
                {canManage ? (
                  <button type="button" className="v2-gate__button" onClick={() => void remove(file)} disabled={busy}>
                    {japanese ? "取り外す" : "Remove"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {files.length ? (
        <p className="v2-note">{downloadable ? contentDownloadWatermarkNotice(japanese) : contentDownloadNoneNotice(japanese)}</p>
      ) : null}
      {canManage ? <V2ContentDownloadEditor targetType={targetType} targetId={targetId} gated japanese={japanese} /> : null}
      {canManage ? (
        <label className="v2-content-files__upload">
          {japanese
            ? "ファイルを添付する（閲覧条件を付けた投稿・記事だけ。検査が済むまで配られません）"
            : "Attach a file (gated content only; delivered after a malware scan)"}
          <input
            type="file"
            disabled={busy}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = "";
              if (selected) void upload(selected);
            }}
          />
        </label>
      ) : null}
      {message ? <p className="v2-note" role="status">{message}</p> : null}
    </section>
  );
}
