"use client";

import { useState } from "react";

type Preview = {
  verified: true;
  headHash: string | null;
  total: number;
  pending: number;
  alreadyRestored: number;
  byType: Record<string, number>;
  warnings: string[];
};

export function PersonalNodeRestore({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [bundle, setBundle] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function selectFile(file: File | undefined) {
    setBundle(null);
    setPreview(null);
    setConfirmation("");
    setMessage("");
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setMessage(ja ? "ファイルは8MB以下にしてください。" : "The file must be 8 MB or smaller.");
      return;
    }
    try {
      setBundle(JSON.parse(await file.text()) as unknown);
      setFileName(file.name);
      setMessage(ja ? "ファイルを読み込みました。次に検証してください。" : "File loaded. Verify it next.");
    } catch {
      setMessage(ja ? "有効なJSONファイルではありません。" : "This is not valid JSON.");
    }
  }

  async function request(action: "preview" | "apply") {
    if (!bundle || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/core/personal-node/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, bundle, confirmation }),
      });
      const payload = await response.json().catch(() => null) as
        | Preview
        | { restored?: boolean; applied?: number; alreadyPresent?: number; skipped?: number; conflicts?: number; error?: string }
        | null;
      if (!response.ok || !payload) throw new Error("error" in (payload ?? {}) ? String((payload as { error?: string }).error) : "request_failed");
      if (action === "preview") {
        setPreview(payload as Preview);
        setMessage(ja ? "署名とイベントチェーンを検証しました。" : "Signatures and the event chain are verified.");
      } else {
        const result = payload as { applied?: number; alreadyPresent?: number; skipped?: number; conflicts?: number };
        setMessage(ja
          ? `復元完了：適用${result.applied ?? 0}件、既存${result.alreadyPresent ?? 0}件、対象外${result.skipped ?? 0}件、競合${result.conflicts ?? 0}件`
          : `Restore complete: ${result.applied ?? 0} applied, ${result.alreadyPresent ?? 0} existing, ${result.skipped ?? 0} skipped, ${result.conflicts ?? 0} conflicts.`);
        setConfirmation("");
        await requestPreviewAfterApply();
      }
    } catch (error) {
      setMessage(ja
        ? `復元処理に失敗しました。${error instanceof Error ? error.message : ""}`
        : `Restore failed. ${error instanceof Error ? error.message : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function requestPreviewAfterApply() {
    const response = await fetch("/api/core/personal-node/import", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "preview", bundle }),
    });
    if (response.ok) setPreview(await response.json() as Preview);
  }

  return (
    <section className="settings-note" aria-busy={busy}>
      <strong>{ja ? "署名データから復元" : "Restore signed data"}</strong>
      <p>{ja
        ? "最初に署名と連番を検証し、変更件数を確認してから現在のプロフィールへ統合します。既存データは一括削除しません。"
        : "The bundle is verified first. Review the changes before merging them into this profile. Existing data is not bulk-deleted."}</p>
      <label className="setting-row">
        <span><strong>{ja ? "エクスポートファイル" : "Export file"}</strong><small>{fileName || "JSON / 8 MB max"}</small></span>
        <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void selectFile(event.target.files?.[0])} />
      </label>
      <button type="button" disabled={!bundle || busy} onClick={() => void request("preview")}>
        {ja ? "署名を検証してプレビュー" : "Verify and preview"}
      </button>
      {preview ? (
        <div className="settings-note">
          <p>{ja ? "総イベント" : "Total events"}: {preview.total}</p>
          <p>{ja ? "未適用" : "Pending"}: {preview.pending}</p>
          <p>{ja ? "適用済み" : "Already restored"}: {preview.alreadyRestored}</p>
          <ul>
            {Object.entries(preview.byType).map(([type, count]) => <li key={type}>{type}: {count}</li>)}
          </ul>
          {preview.warnings.map((warning) => <p role="note" key={warning}>{warning}</p>)}
          {preview.pending > 0 ? (
            <>
              <label className="setting-row">
                <span><strong>{ja ? "RESTORE と入力して確定" : "Type RESTORE to confirm"}</strong></span>
                <input value={confirmation} autoComplete="off" disabled={busy} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              <button type="button" disabled={busy || confirmation !== "RESTORE"} onClick={() => void request("apply")}>
                {ja ? "検証済みイベントを統合" : "Merge verified events"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}
