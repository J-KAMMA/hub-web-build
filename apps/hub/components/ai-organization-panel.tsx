"use client";

import { useEffect, useMemo, useState } from "react";
import type { LocalModel } from "./ai-local-runner-panel";
import { createOrganizationFromTemplate, estimateOrganizationLoad, inferOrganizationTemplate, type AiOrganizationDefinition, type OrganizationTemplateId } from "@/lib/local-ai-organization";
import { OFFICIAL_SKILLS } from "@/lib/ai-skill-registry";
import styles from "./ai-organization-panel.module.css";

type ProviderOption = { id: string; name: string; priceUsd: string; available: boolean };
type OrganizationRole = { id: string; name: string; responsibility: string; providerId: string; reportsToId?: string | null; skillIds?: string[] };
type Organization = AiOrganizationDefinition;
const STORAGE_KEY = "hub.ai.organization.v1";
const initialOrganization: Organization = { name: "新しいAI組織", objective: "", mode: "sequential", budgetUsd: "1.00", roles: [
  { id: crypto.randomUUID(), name: "統括AI", responsibility: "目的を分解し、成果を統合する", providerId: "local:auto", reportsToId: null },
  { id: crypto.randomUUID(), name: "リサーチャー", responsibility: "必要な情報を調査し、根拠を整理する", providerId: "local:auto" },
  { id: crypto.randomUUID(), name: "レビュアー", responsibility: "誤り、リスク、改善点を確認する", providerId: "local:auto" }
] };

export function AiOrganizationPanel({ providers, localModels, onClose, onUse }: { providers: ProviderOption[]; localModels: LocalModel[]; onClose(): void; onUse(prompt: string, organization: Organization): void }) {
  const [organization, setOrganization] = useState<Organization>(initialOrganization);
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { const raw = sessionStorage.getItem(STORAGE_KEY); if (raw) setOrganization(validateOrganization(JSON.parse(raw))); } catch { /* Session-only draft is optional. */ } }, []);
  const estimatedUsd = useMemo(() => organization.roles.reduce((sum, role) => {
    if (role.providerId === "auto") return sum + Math.min(...providers.filter((provider) => provider.available).map((provider) => Number(provider.priceUsd)).filter(Number.isFinite), .2);
    return sum + Number(providers.find((provider) => provider.id === role.providerId)?.priceUsd ?? 0);
  }, 0), [organization.roles, providers]);
  const budget = Number(organization.budgetUsd);
  const load = estimateOrganizationLoad(organization, localModels.length);
  const valid = organization.name.trim() && organization.objective.trim() && organization.roles.length > 0 && organization.roles.every((role) => role.name.trim() && role.responsibility.trim()) && Number.isFinite(budget) && budget > 0 && estimatedUsd <= budget;

  function updateRole(id: string, patch: Partial<OrganizationRole>) { setOrganization((current) => ({ ...current, roles: current.roles.map((role) => role.id === id ? { ...role, ...patch } : role) })); setSaved(false); }
  function save() { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(organization)); setSaved(true); }
  function useOrganization() { save(); onUse(buildOrganizationPrompt(organization), organization); }
  function applyTemplate(id: OrganizationTemplateId) { setOrganization(createOrganizationFromTemplate(id, organization.objective)); setSaved(false); }

  return <section className={styles.overlay} aria-label="AI組織を作成">
    <div className={styles.panel}>
      <header><div><strong>AI組織</strong><small>役割・担当AI・予算を決めて、チームとして依頼します</small></div><button type="button" onClick={onClose}>閉じる</button></header>
      <div className={styles.templates}>{(["development","research","content","commerce","community"] as const).map((id)=><button type="button" key={id} onClick={()=>applyTemplate(id)}>{id === "development" ? "開発" : id === "research" ? "調査" : id === "content" ? "制作" : id === "commerce" ? "商品企画" : "運営"}</button>)}</div>
      <div className={styles.grid}><label>組織名<input value={organization.name} maxLength={80} onChange={(event) => { setOrganization({ ...organization, name: event.target.value }); setSaved(false); }} /></label><label>実行方式<select value={organization.mode} onChange={(event) => setOrganization({ ...organization, mode: event.target.value as Organization["mode"] })}><option value="sequential">順番に実行</option><option value="parallel">並列に実行</option></select></label></div>
      <label>組織の目的<textarea rows={3} maxLength={2000} value={organization.objective} placeholder="例：新サービスの事業計画を、調査・財務・リスクの観点から作る" onChange={(event) => { setOrganization({ ...organization, objective: event.target.value }); setSaved(false); }} /></label>
      <button type="button" disabled={!organization.objective.trim()} onClick={()=>applyTemplate(inferOrganizationTemplate(organization.objective))}>目的から組織を自動編成</button>
      <div className={styles.chart} aria-label="AI組織図">
        <div className={styles.chartNode}><strong>{organization.roles[0]?.name || "統括AI"}</strong><span>{organization.roles[0]?.providerId === "local:auto" ? "PCローカルAI" : "統括"}</span></div>
        <div className={styles.chartLine} />
        <div className={styles.chartChildren}>{organization.roles.slice(1).map((role) => <div className={styles.chartNode} key={role.id}><strong>{role.name || "役割未設定"}</strong><span>{role.providerId === "local:auto" ? "PCローカルAI" : role.providerId === "auto" ? "自動選択" : role.providerId}</span><small>{role.responsibility || "責任範囲を設定"}</small></div>)}</div>
      </div>
      <div className={styles.roles}>{organization.roles.map((role, index) => <article className={styles.role} key={role.id}><div className={styles.roleHeader}><strong>{index === 0 ? "統括" : `役割 ${index + 1}`}</strong><button type="button" onClick={() => setOrganization((current) => ({ ...current, roles: current.roles.filter((item) => item.id !== role.id) }))} disabled={organization.roles.length === 1 || index === 0}>削除</button></div><div className={styles.roleGrid}><label>役割名<input value={role.name} maxLength={60} onChange={(event) => updateRole(role.id, { name: event.target.value })} /></label><label>責任範囲<input value={role.responsibility} maxLength={500} onChange={(event) => updateRole(role.id, { responsibility: event.target.value })} /></label><label>担当AI<select value={role.providerId} onChange={(event) => updateRole(role.id, { providerId: event.target.value })}><option value="local:auto">PCローカルAI · 自動</option>{localModels.map((model)=><option key={`${model.runtime}:${model.id}`} value={`local:${model.runtime}:${model.id}`}>{model.name} · PC内</option>)}<option value="auto">外部を含めて自動</option>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.name} · ${provider.priceUsd}</option>)}</select></label><label>スキル<select value={role.skillIds?.[0]??""} onChange={(event)=>updateRole(role.id,{skillIds:event.target.value?[event.target.value]:[]})}><option value="">自動選択</option>{OFFICIAL_SKILLS.map((skill)=><option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label></div></article>)}</div>
      <button type="button" onClick={() => setOrganization((current) => ({ ...current, roles: [...current.roles, { id: crypto.randomUUID(), name: "新しい役割", responsibility: "", providerId: "local:auto", reportsToId: current.roles[0]?.id ?? null }] }))} disabled={organization.roles.length >= 12}>役割を追加</button>
      <div className={styles.grid}><label>1回の予算上限（USD）<input inputMode="decimal" value={organization.budgetUsd} onChange={(event) => setOrganization({ ...organization, budgetUsd: event.target.value })} /></label><p className={`${styles.budget} ${estimatedUsd > budget ? styles.danger : ""}`}>概算 ${estimatedUsd.toFixed(2)} / 上限 ${Number.isFinite(budget) ? budget.toFixed(2) : "-"}<br/>PC負荷 {load.level === "high" ? "高" : load.level === "medium" ? "中" : "低"} · {load.calls}工程 · 最大{load.concurrent}並列</p></div>
      <div className={styles.actions}><span>{saved ? "このブラウザセッションに保存しました" : "組織設定はサーバーへ保存されません"}</span><div className={styles.actions}><button type="button" onClick={save}>下書き保存</button><button type="button" disabled={!valid} onClick={useOrganization}>この組織へ依頼</button></div></div>
    </div>
  </section>;
}

function buildOrganizationPrompt(organization: Organization): string {
  const roles = organization.roles.map((role, index) => `${index + 1}. ${role.name}: ${role.responsibility}${role.providerId === "auto" ? "（最適なAIを自動選択）" : `（担当: ${role.providerId}）`}${role.skillIds?.length?`（スキル: ${role.skillIds.join("・")}）`:""}`).join("\n");
  return `AI組織「${organization.name}」として次の目的に取り組んでください。\n目的: ${organization.objective}\n実行方式: ${organization.mode === "parallel" ? "独立した役割を並列に検討し、最後に統合" : "役割を順番に実行し、前段の成果を次へ引き継ぐ"}\n役割:\n${roles}\n予算上限: $${organization.budgetUsd}\n各役割の成果と、最後の統合結論を明確に分けてください。`;
}
function validateOrganization(value: unknown): Organization {
  if (!value || typeof value !== "object") throw new Error("invalid_organization");
  const candidate = value as Partial<Organization>;
  if (typeof candidate.name !== "string" || typeof candidate.objective !== "string" || !Array.isArray(candidate.roles) || candidate.roles.length < 1 || candidate.roles.length > 12) throw new Error("invalid_organization");
  return { name: candidate.name.slice(0, 80), objective: candidate.objective.slice(0, 2000), mode: candidate.mode === "parallel" ? "parallel" : "sequential", budgetUsd: typeof candidate.budgetUsd === "string" ? candidate.budgetUsd : "1.00", roles: candidate.roles.map((role) => ({ id: typeof role.id === "string" ? role.id : crypto.randomUUID(), name: typeof role.name === "string" ? role.name.slice(0, 60) : "役割", responsibility: typeof role.responsibility === "string" ? role.responsibility.slice(0, 500) : "", providerId: typeof role.providerId === "string" ? role.providerId : "auto", skillIds: Array.isArray(role.skillIds) ? role.skillIds.filter((item): item is string => typeof item === "string").slice(0, 10) : [] })) };
}
