"use client";

import { useCallback, useEffect, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";

/*
 * 他のハブのドメイン方針（運営者用）。allow=通常、limit=1時間120件まで、suspend=受け取りも送りもしない。
 * 初めて見るドメインは最初の7日間 limit（自動）。明示するとその方針で固定される。
 */
type Action = "allow" | "limit" | "suspend";
type Row = {
  domain: string;
  action: Action | null;
  effective: Action;
  probation: boolean;
  probationEndsAt: string | null;
  reason: string;
  remoteProfiles: number;
  firstSeenAt: string | null;
};

export function V2DomainPolicies({ japanese }: { japanese: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "failed">("loading");
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/federation/domains", { credentials: "same-origin", signal: AbortSignal.timeout(30_000) });
      const payload = await response.json().catch(() => ({})) as { domains?: Row[]; federationAvailable?: boolean; error?: string };
      if (!response.ok || !payload.domains) throw new Error(payload.error || String(response.status));
      setRows(payload.domains);
      setAvailable(payload.federationAvailable !== false);
      setState("idle");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : null);
      setState("failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const labels: Record<Action, string> = {
    allow: japanese ? "許可" : "Allow",
    limit: japanese ? "制限" : "Limit",
    suspend: japanese ? "停止" : "Suspend",
  };

  const set = async (domain: string, action: Action) => {
    if (busy) return;
    if (action === "suspend" && !window.confirm(japanese ? `${domain} との送受信を止めます。よろしいですか。` : `Stop all traffic with ${domain}?`)) return;
    setBusy(domain);
    setMessage(null);
    try {
      const response = await fetch("/api/federation/domains", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, action }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error && caught.message ? caught.message : (japanese ? "反映できませんでした。" : "That did not go through."));
    } finally {
      setBusy(null);
    }
  };

  const status = (row: Row) => row.probation
    ? (japanese ? `制限（新規・${(row.probationEndsAt ?? "").slice(0, 10)} まで）` : `Limited (new, until ${(row.probationEndsAt ?? "").slice(0, 10)})`)
    : labels[row.effective];

  return (
    <section className="v2-domain-policies">
      <p className="v2-note">
        {japanese
          ? "初めて見るドメインは、最初の7日間は「制限」（1時間に120件まで）になります。明示すると、その方針で固定されます。"
          : "A domain seen for the first time is limited (120 messages per hour) for 7 days. Setting it explicitly pins it."}
      </p>
      {!available ? <p className="v2-error" role="alert">{japanese ? "連合のサービスにつなげません。方針は読み込めていません。" : "Federation is unreachable; policies could not be loaded."}</p> : null}
      {message ? <p className="v2-error" role="alert">{message}</p> : null}
      <form
        className="v2-search__form"
        onSubmit={(event) => {
          event.preventDefault();
          const domain = newDomain.trim().toLowerCase();
          if (domain) { void set(domain, "limit"); setNewDomain(""); }
        }}
      >
        <input type="text" value={newDomain} maxLength={255} placeholder="hub.example" aria-label={japanese ? "ドメインを追加" : "Add a domain"} onChange={(event) => setNewDomain(event.target.value)} />
        <V2Button type="submit" variant="text" label={japanese ? "制限で追加" : "Add as limited"} disabled={!newDomain.trim() || Boolean(busy)} />
      </form>
      {state === "loading" && !rows.length ? <p className="v2-note">{japanese ? "読み込んでいます…" : "Loading…"}</p> : null}
      {state === "failed" && !rows.length ? <V2Button variant="text" label={japanese ? "再試行" : "Retry"} onClick={() => void load()} /> : null}
      {state === "idle" && !rows.length ? <p className="v2-note">{japanese ? "まだ他のハブとのやり取りはありません。" : "No other Hubs yet."}</p> : null}
      {rows.length ? (
        <ul className="v2-people">
          {rows.map((row) => (
            <li key={row.domain} className="v2-person v2-person--with-action">
              <span className="v2-person__body">
                <span className="v2-post__name">{row.domain}</span>
                <span className="v2-post__handle">
                  {status(row)} · {japanese ? `${row.remoteProfiles}人` : `${row.remoteProfiles} people`}
                  {row.firstSeenAt ? ` · ${row.firstSeenAt.slice(0, 10)}` : ""}
                </span>
              </span>
              <span className="v2-post__actions">
                {(["allow", "limit", "suspend"] as const).map((action) => (
                  <V2Button
                    key={action}
                    variant="text"
                    label={labels[action]}
                    pressed={!row.probation && row.action === action}
                    disabled={busy === row.domain}
                    onClick={() => void set(row.domain, action)}
                  />
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
