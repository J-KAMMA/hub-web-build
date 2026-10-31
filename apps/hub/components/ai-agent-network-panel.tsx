"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Handshake, Plus, RefreshCw, X } from "lucide-react";

import styles from "./ai-agent-network-panel.module.css";

type AgentCard = {
  id: string;
  actorType: "personal" | "organization" | "service";
  name: string;
  description: string;
  capabilities: string[];
  visibility: "private" | "discoverable";
  owned: boolean;
};

type Negotiation = {
  id: string;
  initiatorAgentId: string;
  counterpartyAgentId: string;
  objective: string;
  status: string;
  proposalVersion: number;
  summary?: string | null;
  terms?: Record<string, string | number | boolean> | null;
  expiresAt: number;
};

const STATUS: Record<string, string> = {
  negotiating: "交渉中",
  approval_required: "人間の承認待ち",
  agreed: "条件合意",
  rejected: "不成立",
  cancelled: "取消済み",
  expired: "期限切れ",
};

export function AiAgentNetworkPanel() {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [name, setName] = useState("Personal Agent");
  const [objective, setObjective] = useState("hub.communication.message.mediate");
  const [initiatorAgentId, setInitiatorAgentId] = useState("");
  const [counterpartyAgentId, setCounterpartyAgentId] = useState("");
  const [summary, setSummary] = useState("");
  const [budget, setBudget] = useState("0");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [agentResponse, negotiationResponse] = await Promise.all([
        fetch("/ai/api/a2a/agents", { credentials: "same-origin", cache: "no-store" }),
        fetch("/ai/api/a2a/negotiations", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!agentResponse.ok || !negotiationResponse.ok) throw new Error("Agent情報を取得できませんでした。");
      const agentPayload = await agentResponse.json() as { agents: AgentCard[] };
      const negotiationPayload = await negotiationResponse.json() as { negotiations: Negotiation[] };
      setAgents(agentPayload.agents);
      setNegotiations(negotiationPayload.negotiations);
      const firstOwned = agentPayload.agents.find((agent) => agent.owned)?.id ?? "";
      setInitiatorAgentId((current) => current || firstOwned);
      setCounterpartyAgentId((current) =>
        current || agentPayload.agents.find((agent) => agent.id !== firstOwned)?.id || "",
      );
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "取得できませんでした。");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ownedAgents = useMemo(() => agents.filter((agent) => agent.owned), [agents]);

  async function createAgent() {
    setBusy(true);
    const response = await fetch("/ai/api/a2a/agents", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorType: "personal",
        name,
        description: "利用者の目的と許可範囲に従って交渉案を作る個人AI",
        capabilities: [
          "hub.communication.message.mediate",
          "hub.commerce.purchase.propose",
        ],
        approvalScopes: ["contract", "payment", "personal_data", "publish"],
        visibility: "discoverable",
      }),
    });
    setBusy(false);
    setNotice(response.ok ? "個人Agentを作成しました。" : "Agentを作成できませんでした。");
    if (response.ok) await refresh();
  }

  async function createNegotiation() {
    if (!initiatorAgentId || !counterpartyAgentId || !summary.trim()) return;
    setBusy(true);
    const response = await fetch("/ai/api/a2a/negotiations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initiatorAgentId,
        counterpartyAgentId,
        objective,
        summary,
        constraints: { budgetMaximum: Number(budget) || 0 },
        negotiable: ["price", "deadline", "scope"],
        terms: { proposal: summary, budgetMaximum: Number(budget) || 0 },
        approvalScopes: ["contract", "payment"],
        expiresAt: Date.now() + 24 * 60 * 60_000,
      }),
    });
    setBusy(false);
    setNotice(response.ok ? "交渉案を作成しました。" : "交渉案を作成できませんでした。");
    if (response.ok) {
      setSummary("");
      await refresh();
    }
  }

  async function decide(negotiation: Negotiation, decision: "accept" | "reject" | "cancel") {
    const response = await fetch(`/ai/api/a2a/negotiations/${encodeURIComponent(negotiation.id)}/decision`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, proposalVersion: negotiation.proposalVersion }),
    });
    setNotice(response.ok ? "交渉状態を更新しました。" : "状態を更新できませんでした。");
    await refresh();
  }

  async function approve(negotiation: Negotiation, scope: "contract" | "payment", decision: "approved" | "denied") {
    const response = await fetch(`/ai/api/a2a/negotiations/${encodeURIComponent(negotiation.id)}/approval`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, decision, proposalVersion: negotiation.proposalVersion }),
    });
    setNotice(response.ok ? "承認状態を更新しました。" : "承認を更新できませんでした。");
    await refresh();
  }

  return (
    <div className={styles.layout}>
      <section>
        <div className={styles.heading}>
          <div><h2>Agent</h2><p>個人AI・組織AI・サービスAIの公開能力だけを発見します。</p></div>
          <button type="button" onClick={() => void refresh()} disabled={busy} aria-label="更新"><RefreshCw /></button>
        </div>
        {ownedAgents.length === 0 ? (
          <div className={styles.create}>
            <label>Agent名<input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void createAgent()}><Plus />個人Agentを作成</button>
          </div>
        ) : null}
        <div className={styles.cards}>
          {agents.map((agent) => (
            <article key={agent.id}>
              <Bot />
              <span><strong>{agent.name}</strong><small>{agent.actorType} · {agent.capabilities.length} capabilities</small></span>
              {agent.owned ? <em>自分</em> : null}
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className={styles.heading}><div><h2>交渉案</h2><p>AI同士は案を作れますが、契約と支払いは人間承認なしに実行しません。</p></div><Handshake /></div>
        <div className={styles.form}>
          <label>自分のAgent<select value={initiatorAgentId} onChange={(event) => setInitiatorAgentId(event.target.value)}>{ownedAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>相手Agent<select value={counterpartyAgentId} onChange={(event) => setCounterpartyAgentId(event.target.value)}>{agents.filter((agent) => agent.id !== initiatorAgentId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>目的<input value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
          <label>条件案<textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="依頼範囲、納期、変更可能な条件" /></label>
          <label>予算上限<input type="number" min="0" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
          <button type="button" disabled={busy || !initiatorAgentId || !counterpartyAgentId || !summary.trim()} onClick={() => void createNegotiation()}><Handshake />交渉案を作成</button>
        </div>
      </section>

      <section>
        <div className={styles.heading}><div><h2>進行中</h2><p>合意後も契約作成・送金は別の確認工程です。</p></div></div>
        <div className={styles.negotiations}>
          {negotiations.length ? negotiations.map((negotiation) => (
            <article key={negotiation.id}>
              <header><strong>{negotiation.summary || negotiation.objective}</strong><span data-status={negotiation.status}>{STATUS[negotiation.status] ?? negotiation.status}</span></header>
              <small>提案 {negotiation.proposalVersion} · {new Date(negotiation.expiresAt).toLocaleString("ja-JP")}まで</small>
              {negotiation.status === "negotiating" ? <div><button onClick={() => void decide(negotiation, "accept")}><Check />条件案を受け取る</button><button onClick={() => void decide(negotiation, "reject")}><X />拒否</button></div> : null}
              {negotiation.status === "approval_required" ? <div><button onClick={() => void approve(negotiation, "contract", "approved")}>契約条件を承認</button><button onClick={() => void approve(negotiation, "payment", "approved")}>支払上限を承認</button><button onClick={() => void approve(negotiation, "contract", "denied")}><X />拒否</button></div> : null}
            </article>
          )) : <p className={styles.empty}>交渉はまだありません。</p>}
        </div>
      </section>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    </div>
  );
}
