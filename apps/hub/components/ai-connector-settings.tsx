"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Link2, LoaderCircle } from "lucide-react";
import styles from "./ai-connector-settings.module.css";

type Connector = {
  connectorId: string;
  status: string;
  readEnabled: number;
  writePolicy: "ask" | "deny";
  updatedAt?: number | null;
};

const LABELS: Record<string, string> = {
  "google-drive": "Google Drive",
  notion: "Notion",
  github: "GitHub",
  slack: "Slack",
};

function statusLabel(status: string) {
  if (status === "connected") return "接続済み";
  if (status === "error") return "要確認";
  return "未接続";
}

export function AiConnectorSettings({ compact = false }: { compact?: boolean }) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/ai/api/connectors", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("connector_settings_unavailable");
      const payload = (await response.json()) as { connectors?: Connector[] };
      setConnectors(Array.isArray(payload.connectors) ? payload.connectors : []);
      setNotice("");
    } catch {
      setNotice("AIアカウントを接続すると外部サービスの権限を設定できます。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function update(
    connector: Connector,
    patch: Partial<Pick<Connector, "readEnabled" | "writePolicy">>,
  ) {
    setBusyId(connector.connectorId);
    setNotice("");
    const next = { ...connector, ...patch };
    try {
      const response = await fetch(
        `/ai/api/connectors/${encodeURIComponent(connector.connectorId)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            readEnabled: Boolean(next.readEnabled),
            writePolicy: next.writePolicy,
          }),
        },
      );
      if (!response.ok) throw new Error("connector_update_failed");
      setConnectors((current) =>
        current.map((item) =>
          item.connectorId === connector.connectorId ? next : item,
        ),
      );
      setNotice(
        next.status === "connected"
          ? "接続権限を更新しました。"
          : "権限を保存しました。OAuth接続後に適用されます。",
      );
    } catch {
      setNotice("接続設定を更新できませんでした。");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className={compact ? styles.compact : styles.panel}>
      {loading ? (
        <p className={styles.loading} role="status">
          <LoaderCircle aria-hidden="true" />
          接続設定を確認中
        </p>
      ) : connectors.length ? (
        <div className={styles.list}>
          {connectors.map((connector) => {
            const busy = busyId === connector.connectorId;
            return (
              <article key={connector.connectorId}>
                <div className={styles.identity}>
                  <Link2 aria-hidden="true" />
                  <span>
                    <strong>
                      {LABELS[connector.connectorId] ?? connector.connectorId}
                    </strong>
                    <small data-status={connector.status}>
                      {statusLabel(connector.status)}
                    </small>
                  </span>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(connector.readEnabled)}
                    disabled={busy}
                    onChange={(event) =>
                      void update(connector, {
                        readEnabled: event.target.checked ? 1 : 0,
                      })
                    }
                  />
                  読み取り
                </label>
                <label>
                  書き込み
                  <select
                    value={connector.writePolicy}
                    disabled={busy}
                    onChange={(event) =>
                      void update(connector, {
                        writePolicy: event.target.value as "ask" | "deny",
                      })
                    }
                  >
                    <option value="ask">毎回確認</option>
                    <option value="deny">許可しない</option>
                  </select>
                </label>
              </article>
            );
          })}
        </div>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      <p className={styles.note}>
        読み取り対象だけを選びます。公開・送信・購入は自動許可せず、実行時に確認します。
      </p>
    </section>
  );
}
