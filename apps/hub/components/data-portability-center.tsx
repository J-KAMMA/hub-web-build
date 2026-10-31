"use client";

import { Download } from "lucide-react";
import React, { useState } from "react";

import { UiButton } from "@/components/ui/primitives";

type ExportKind = "hub" | "account" | "ai" | "music" | "vault" | "commerce";

const EXPORTS: ReadonlyArray<{
  kind: ExportKind;
  title: string;
  description: string;
}> = [
  {
    kind: "hub",
    title: "Hub",
    description: "プロフィール、投稿、フォロー、リスト、保存済み項目",
  },
  {
    kind: "account",
    title: "Account",
    description: "表示名、パスキー端末情報、セッション、サービス連携履歴",
  },
  {
    kind: "ai",
    title: "AI",
    description: "同期したメモリ、会話、プロジェクト、設定",
  },
  {
    kind: "music",
    title: "音楽",
    description: "作品メタデータ、制作プロジェクト、権利確認、審査履歴",
  },
  {
    kind: "vault",
    title: "Vault",
    description: "公開物、非公開原稿、検査済みファイル、アクセス権",
  },
  {
    kind: "commerce",
    title: "購入・決済",
    description: "注文、明細、領収情報、返品、返金、税務記録",
  },
];

async function assertion(path: string) {
  const response = await fetch(`/account/api/v1/assertions/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as {
    assertion?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof payload?.assertion !== "string") {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "service_assertion_unavailable",
    );
  }
  return payload.assertion;
}

async function exportResponse(kind: ExportKind) {
  if (kind === "hub") {
    return fetch("/api/core/portability/export", {
      credentials: "same-origin",
      cache: "no-store",
    });
  }
  if (kind === "account") {
    return fetch("/account/api/v1/data-export", {
      credentials: "same-origin",
      cache: "no-store",
    });
  }
  if (kind === "ai") {
    const token = await assertion("ai");
    return fetch("/ai/api/account-data", {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
  }
  if (kind === "music") {
    const token = await assertion("music");
    return fetch("/music/api/data-export", {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
  }
  if (kind === "commerce") {
    const token = await assertion("payment-data-export");
    return fetch("/commerce/api/v1/payment/data-export", {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
  }
  return fetch("/vault/api/account/data-export", {
    credentials: "same-origin",
    cache: "no-store",
  });
}

function responseFilename(response: Response, kind: ExportKind) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return (
    match?.[1] ??
    `jkamma-${kind}-export-${new Date().toISOString().slice(0, 10)}.json`
  );
}

export function DataPortabilityCenter() {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [status, setStatus] = useState("");

  async function download(kind: ExportKind) {
    setBusy(kind);
    setStatus("");
    try {
      const response = await exportResponse(kind);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        const reason =
          typeof payload?.error === "string"
            ? payload.error
            : `HTTP ${response.status}`;
        throw new Error(reason);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = responseFilename(response, kind);
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(
        `${EXPORTS.find((item) => item.kind === kind)?.title ?? kind}のデータを書き出しました。`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "export_failed";
      setStatus(
        reason === "recent_authentication_required"
          ? "安全のためAccountへ再ログインしてから、もう一度実行してください。"
          : `データを書き出せませんでした（${reason}）。`,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {EXPORTS.map((item) => (
        <div className="setting-row" key={item.kind}>
          <span>
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </span>
          <UiButton
            type="button"
            disabled={busy !== null}
            onClick={() => void download(item.kind)}
          >
            <Download aria-hidden="true" />
            {busy === item.kind ? "準備中" : "書き出す"}
          </UiButton>
        </div>
      ))}
      <div className="settings-note">
        <strong>サービスごとに直接取得します</strong>
        <p>
          Hubは、Account・AI・音楽・Vault・Commerceが所有するデータを受け取ったり、
          まとめて保存したりしません。
        </p>
      </div>
      {status ? (
        <p className="settings-note" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
