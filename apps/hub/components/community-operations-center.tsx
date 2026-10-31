"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { CommunityInfrastructurePanel } from "@/components/community-infrastructure-panel";
import {CommunityChannelPolicyControls,type CommunityChannelPolicyMemory} from '@/components/community-channel-policy';
import {CommunityChannelAccessGates} from '@/components/community-channel-access-gates';
import {CommunityRemoteParticipationControls} from '@/components/community-remote-participation';
import {CommunityAccessManagementControls,type CommunityAccessManagementMemory} from '@/components/community-access-management';

type OperationsData = {
  role: "owner" | "moderator";
  requests: Array<{ profileId: string; displayName: string; createdAt: string }>;
  reports: Array<{ id: string; reporterName: string; reason: string; messageBody: string; messageEditedAt: string|null; createdAt: string }>;
  audit: Array<{ id: string; action: string; detail: string; actorName: string; targetName?: string; createdAt: string }>;
  invites: Array<{ id: string; label: string; maxUses?: number; useCount: number; expiresAt?: string; revokedAt?: string }>;
  customRoles: Array<{ id: string; name: string; canManageChannels: number; canManagePosts: number; canManageMembers: number; canManageGuides: number }>;
  rules: Array<{ id: string; title: string; body: string; required: number }>;
  metrics: Array<{ metricDay: string; activeMembers: number; joins: number; leaves: number; posts: number; reports: number }>;
  members: Array<{ profileId: string; displayName: string; role: string; status: string; customRoleIds?: string }>;
  channels: Array<{ id: string; name: string; archivedAt?: string; slowmodeSeconds: number }>;
  permissions: Array<{ channelId: string; roleId: string; canView: number; canPost: number; canManage: number }>;
  onboardingQuestions: Array<{ id: string; prompt: string; required: number }>;
  appeals: Array<{ id: string; reason: string; displayName: string; createdAt: string }>;
  autoRoleRules: Array<{ id: string; roleId: string; roleName: string; criterion: string; threshold: string; enabled: number }>;
  tokens: Array<{ id: string; name: string; symbol: string; network: string }>;
  bots: Array<{ id: string; name: string; kind: "welcome" | "moderation" | "guide_watch" | "governance" | "recruitment" | "digest"; channelId?: string; channelName?: string; enabled: number; permissionsJson: string; updatedAt: string }>;
  botRuns: Array<{ id: string; botId: string; botName: string; triggerType: string; status: string; matchedCount: number; summary: string; completedAt: string }>;
};

type CriticalAction = {
  action: "delete_role" | "delete_rule" | "delete_onboarding_question" | "delete_bot" | "set_channel_archived" | "member_action" | "resolve_report" | "resolve_appeal" | "membership" | "create_invite" | "revoke_invite" | "close" | "assign_role" | "channel_permission" | "create_auto_role_rule" | "delete_auto_role_rule";
  title: string;
  target: string;
  impact: string;
  payload: Record<string, unknown>;
  operationId: string;
  communityId: string;
  operationVersion: number;
};

type ActionReceipt = {
  auditId: string;
  action: string;
  targetId: string;
  targetLabel: string;
  confirmedAt: string;
  replayed: boolean;
  membershipEffect?: "unmuted" | "unchanged";
};

type ScopedReceipt = ActionReceipt & { communityId: string; operationVersion: number };

type OperationsLoadState = "loading" | "ready" | "error";

function displayAuditDetail(value: string) {
  try {
    const parsed = JSON.parse(value) as { note?: string; targetLabel?: string };
    return [parsed.targetLabel, parsed.note].filter(Boolean).join("・") || value;
  } catch {
    return value;
  }
}

export function CommunityOperationsCenter({ communityId, communityName, open, onClose }: { communityId: string; communityName: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loadState, setLoadState] = useState<OperationsLoadState>("loading");
  const [tab, setTab] = useState<"overview" | "queue" | "access" | "rules" | "infrastructure" | "bots" | "insights" | "safety">("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");


  const [roleName, setRoleName] = useState("");
  const [autoRoleThresholds, setAutoRoleThresholds] = useState<Record<string, string>>({});



  const [verificationReason, setVerificationReason] = useState("");
  const [closeName, setCloseName] = useState("");
  const [botName, setBotName] = useState("");
  const [botKind, setBotKind] = useState<OperationsData["bots"][number]["kind"]>("welcome");
  const [botChannelId, setBotChannelId] = useState("");
  const [pendingCritical, setPendingCritical] = useState<CriticalAction | null>(null);
  const [criticalNote, setCriticalNote] = useState("");
  const [receipt, setReceipt] = useState<ScopedReceipt | null>(null);
  const [notificationRetry,setNotificationRetry]=useState<{body:Record<string,unknown>;communityId:string;operationVersion:number}|null>(null);
  const loadVersionRef = useRef(0);
  const operationVersionRef = useRef(0);
  const activeCommunityIdRef = useRef(communityId);
  const openRef = useRef(open);
  const channelPolicyMemory=useRef<CommunityChannelPolicyMemory>(new Map());
  const accessManagementMemory=useRef<CommunityAccessManagementMemory>(new Map());
  activeCommunityIdRef.current = communityId;
  openRef.current = open;
  const isCurrentScope = () => openRef.current && activeCommunityIdRef.current === communityId;
  const activePendingCritical = pendingCritical
    && isCurrentScope()
    && pendingCritical.communityId === communityId
    && pendingCritical.operationVersion === operationVersionRef.current
    ? pendingCritical
    : null;
  const activeReceipt = receipt
    && isCurrentScope()
    && receipt.communityId === communityId
    && receipt.operationVersion === operationVersionRef.current
    ? receipt
    : null;
  const activeNotificationRetry=notificationRetry && isCurrentScope() && notificationRetry.communityId===communityId
    && notificationRetry.operationVersion===operationVersionRef.current?notificationRetry:null;

  const load = useCallback(async () => {
    if (activeCommunityIdRef.current !== communityId || !openRef.current) return;
    const loadVersion = ++loadVersionRef.current;
    const isCurrent = () => loadVersion === loadVersionRef.current
      && activeCommunityIdRef.current === communityId
      && openRef.current;
    setLoadState("loading");
    setError("");
    setData(null);
    try {
      const response = await fetch(`/api/communities/${communityId}/operations`);
      const payload = await response.json().catch(() => null) as (OperationsData & { error?: string }) | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "運営情報を取得できませんでした。");
      }
      if (!isCurrent()) return;
      setData(payload);
      setLoadState("ready");
    } catch (cause) {
      if (!isCurrent()) return;
      setLoadState("error");
      setError(cause instanceof Error ? cause.message : "運営情報を取得できませんでした。");
    }
  }, [communityId]);

  useEffect(()=>{
    const changed=()=>{channelPolicyMemory.current.clear();accessManagementMemory.current.clear();operationVersionRef.current++;setData(null);setPendingCritical(null);setReceipt(null);setNotificationRetry(null);void load();};
    window.addEventListener('hub-account-changed',changed);
    return()=>window.removeEventListener('hub-account-changed',changed);
  },[load]);

  useEffect(() => {
    operationVersionRef.current += 1;
    setPendingCritical(null);
    setCriticalNote("");
    setReceipt(null);
    setNotificationRetry(null);    setBusy(false);
    setError("");
    setRoleName("");
    setAutoRoleThresholds({});    setVerificationReason("");
    setCloseName("");
    setBotName("");
    setBotKind("welcome");
    setBotChannelId("");
    return () => { operationVersionRef.current += 1; };
  }, [communityId, open]);
  useEffect(() => {
    if (!open) {
      loadVersionRef.current += 1;
      return;
    }
    void load();
    return () => { loadVersionRef.current += 1; };
  }, [load, open]);
  useEffect(() => {
    if (!activePendingCritical) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setPendingCritical(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [activePendingCritical, busy]);
  if (!open) return null;

  const act = async (body: Record<string, unknown>, reload = true) => {
    const operationVersion = operationVersionRef.current;
    const isCurrentOperation = () => operationVersion === operationVersionRef.current && isCurrentScope();
    if (!isCurrentOperation()) return false;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/communities/${communityId}/operations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!isCurrentOperation()) return false;
      if (!response.ok) throw new Error(payload.error ?? "操作を完了できませんでした。");
      if(body.action === "membership" && (payload.ok!==true || payload.receipt?.auditId!==body.operationId || payload.receipt?.targetId!==body.profileId || payload.receipt?.action!=="membership"))throw new Error("保存結果を確認できませんでした。同じ内容で再試行してください。");
      if(body.action === "resolve_report" && (payload.ok!==true || payload.receipt?.auditId!==body.operationId || payload.receipt?.targetId!==body.reportId || payload.receipt?.action!=="resolve_report" || payload.report?.id!==body.reportId || payload.report?.status!==(body.resolution==="actioned"?"resolved":"dismissed")))throw new Error("保存結果を確認できませんでした。同じ内容で再試行してください。");
      if(body.action === "resolve_appeal" && (payload.ok!==true || payload.receipt?.auditId!==body.operationId || payload.receipt?.targetId!==body.appealId || payload.receipt?.action!=="resolve_appeal" || payload.appeal?.id!==body.appealId || payload.appeal?.status!==body.decision || payload.receipt?.membershipEffect!==body.expectedMembershipEffect))throw new Error("保存結果を確認できませんでした。同じ内容で再試行してください。");      if (payload.receipt) setReceipt({ ...(payload.receipt as ActionReceipt), communityId, operationVersion });
      if(body.action==="resolve_report")setNotificationRetry(payload.notificationPending===true?{body,communityId,operationVersion}:null);
      if (reload) await load();
      if (!isCurrentOperation()) return false;
      return true;
    } catch (cause) {
      if (!isCurrentOperation()) return false;
      setError(cause instanceof Error ? cause.message : "操作を完了できませんでした。");
      return false;
    }
    finally { if (isCurrentOperation()) setBusy(false); }
  };

  const requestCritical = (input: Omit<CriticalAction, "operationId" | "communityId" | "operationVersion">) => {
    if (!isCurrentScope()) return;
    setCriticalNote("");
    setReceipt(null);
    setPendingCritical({ ...input, operationId: crypto.randomUUID(), communityId, operationVersion: operationVersionRef.current });
  };

  const requestAppealReview = async (item:OperationsData["appeals"][number],decision:"accepted"|"rejected") => {
    if(busy || !isCurrentScope())return;
    const version=operationVersionRef.current;
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/communities/${communityId}/appeals/${item.id}`),payload=await response.json();
      if(version!==operationVersionRef.current || !isCurrentScope())return;
      const appeal=payload.appeal;
      if(!response.ok)throw new Error(payload.error??"異議申立てを確認できませんでした。");
      if(payload.communityId!==communityId || appeal?.id!==item.id || appeal.status!=="pending" || appeal.canResolve!==true || typeof appeal.createdAt!=="string" || !/^[a-f0-9]{64}$/.test(appeal.sanctionKey))throw new Error("審査対象や権限が変更されました。読み直してください。");
      const unmute=decision==="accepted" && appeal.canUnmute===true;
      requestCritical({action:"resolve_appeal",title:decision==="accepted"?"異議申立てを承認":"異議申立てを棄却",target:`${appeal.displayName}の異議申立て`,
        impact:unmute?"申立ての対象と現在の投稿停止が一致しています。承認すると、この投稿停止だけを解除します。":`審査結果を記録します。現在のメンバー状態は変更しません。${appeal.restrictionReason??""}`,
        payload:{appealId:appeal.id,decision,expectedCreatedAt:appeal.createdAt,expectedSanctionKey:appeal.sanctionKey,expectedMembershipEffect:unmute?"unmuted":"unchanged"}});
    }catch(cause){if(version===operationVersionRef.current && isCurrentScope())setError(cause instanceof Error?cause.message:"異議申立てを確認できませんでした。");}
    finally{if(version===operationVersionRef.current && isCurrentScope())setBusy(false);}
  };

  const confirmCritical = async () => {
    if (!activePendingCritical || criticalNote.trim().length < 5 || busy) return;
    const completed = await act({
      action: activePendingCritical.action,
      ...activePendingCritical.payload,
      note: criticalNote.trim(),
      operationId: activePendingCritical.operationId,
    });
    if (completed) {
      const closed = activePendingCritical.action === "close";      setPendingCritical(null);
      if (closed) onClose();
    }
  };

  return <div className="community-modal-backdrop" role="presentation">
    <section className="community-modal community-operations" role="dialog" aria-modal="true" aria-labelledby="community-operations-title">
      <header><div><span>COMMUNITY OPERATIONS</span><h2 id="community-operations-title">運営センター</h2></div><button type="button" aria-label="閉じる" onClick={onClose}>×</button></header>
      <nav aria-label="運営メニュー">
        {[["overview","概要"],["queue","受信箱"],["access","権限・招待"],["rules","参加設定"],["infrastructure","保存・配信"],["bots","Bot"],["insights","分析・履歴"],["safety","安全・閉鎖"]].map(([id,label]) => <button key={id} type="button" className={tab === id ? "is-active" : ""} onClick={() => setTab(id as typeof tab)}>{label}</button>)}
      </nav>
      {error && loadState !== "error" ? <p className="community-error" role="alert">{error}</p> : null}
      {loadState === "loading" ? <p className="community-operations__empty" role="status">運営情報を読み込んでいます…</p> : null}
      {loadState === "error" ? <section className="community-operations__empty" aria-labelledby="community-operations-load-error">
        <h3 id="community-operations-load-error">運営情報を読み込めませんでした</h3>
        <p className="community-error" role="alert">{error}</p>
        <button type="button" disabled={busy} onClick={() => void load()}>再試行</button>
      </section> : null}
      {loadState === "ready" && data ? <div className="community-operations__body">
        {tab === "overview" && <>
          <section className="community-operations__summary">
            <header><div><h3>{communityName}の運営状況</h3><small>重要な項目を一か所で確認できます</small></div></header>
            <div className="community-operations__summary-grid">
              <button type="button" onClick={() => setTab("queue")}><strong>{data.requests.length + data.reports.length + data.appeals.length}</strong><span>対応待ち</span></button>
              <button type="button" onClick={() => setTab("access")}><strong>{data.members.length}</strong><span>メンバー</span></button>
              <button type="button" onClick={() => setTab("access")}><strong>{data.channels.filter((channel) => !channel.archivedAt).length}</strong><span>公開中チャンネル</span></button>
              <button type="button" onClick={() => setTab("bots")}><strong>{data.bots.filter((bot) => bot.enabled).length}</strong><span>稼働中Bot</span></button>
            </div>
          </section>
          <section>
            <header><h3>次に確認すること</h3></header>
            {data.reports.length > 0 ? <button type="button" className="community-operations__next" onClick={() => setTab("queue")}>未処理の通報が{data.reports.length}件あります</button> : null}
            {data.requests.length > 0 ? <button type="button" className="community-operations__next" onClick={() => setTab("queue")}>参加申請が{data.requests.length}件あります</button> : null}
            {data.appeals.length > 0 ? <button type="button" className="community-operations__next" onClick={() => setTab("queue")}>異議申立てが{data.appeals.length}件あります</button> : null}
            {!data.reports.length && !data.requests.length && !data.appeals.length ? <p>急いで対応する項目はありません。</p> : null}
          </section>
        </>}
        {tab === "queue" && <>
          <section><header><h3>参加申請</h3><small>{data.requests.length}件</small></header>{data.requests.length ? data.requests.map((item) => <article key={item.profileId}><div><strong>{item.displayName}</strong><small>{new Date(item.createdAt).toLocaleString("ja-JP")}</small></div><span><button disabled={busy} onClick={() => requestCritical({ action: "membership", title: "参加申請を却下", target: `${item.displayName}の参加申請`, impact: "申請を却下し、この申請ではコミュニティへ参加できない状態にします。本人は将来あらためて申請できます。", payload: { profileId: item.profileId, expectedCreatedAt:item.createdAt, decision: "reject" } })}>却下</button><button className="is-primary" disabled={busy} onClick={() => requestCritical({ action: "membership", title: "参加申請を承認", target: `${item.displayName}の参加申請`, impact: "この利用者へコミュニティの閲覧・投稿権限を付与し、メンバーとして参加させます。", payload: { profileId: item.profileId, expectedCreatedAt:item.createdAt, decision: "approve" } })}>承認</button></span></article>) : <p>対応待ちの申請はありません。</p>}</section>
          <section><header><h3>通報キュー</h3><small>{data.reports.length}件</small></header>{data.reports.length ? data.reports.map((item) => <article key={item.id}><div><strong>{item.reason}・{item.reporterName}</strong><p>{item.messageBody}</p></div><span><button disabled={busy} onClick={() => requestCritical({ action: "resolve_report", title: "通報を問題なしとして処理", target: `${item.reporterName}からの通報「${item.reason}」`, impact: "この通報を未処理一覧から外します。対象投稿やメンバーへの処分は行いません。", payload: { reportId: item.id, expectedCreatedAt:item.createdAt, expectedMessageEditedAt:item.messageEditedAt, resolution: "dismissed" } })}>問題なし</button><button className="is-primary" disabled={busy} onClick={() => requestCritical({ action: "resolve_report", title: "通報を対応済みにする", target: `${item.reporterName}からの通報「${item.reason}」`, impact: "運営対応済みとして通報を閉じます。この操作自体は投稿削除やメンバー処分を実行しません。", payload: { reportId: item.id, expectedCreatedAt:item.createdAt, expectedMessageEditedAt:item.messageEditedAt, resolution: "actioned" } })}>対応済み</button></span></article>) : <p>未処理の通報はありません。</p>}</section>
          <section><header><h3>処分への異議申立て</h3><small>{data.appeals.length}件</small></header>{data.appeals.length ? data.appeals.map((item) => <article key={item.id}><div><strong>{item.displayName}</strong><p>{item.reason}</p><small>{new Date(item.createdAt).toLocaleString("ja-JP")}</small></div><span><button disabled={busy} onClick={() => void requestAppealReview(item,"rejected")}>棄却</button><button className="is-primary" disabled={busy} onClick={() => void requestAppealReview(item,"accepted")}>承認を確認</button></span></article>) : <p>審査待ちの異議申立てはありません。</p>}</section>
          <section><header><h3>Botからの検知</h3><small>最新{Math.min(data.botRuns.length, 10)}件</small></header>{data.botRuns.length ? data.botRuns.slice(0, 10).map((run) => <article key={run.id}><div><strong>{run.botName}</strong><p>{run.summary}</p><small>{new Date(run.completedAt).toLocaleString("ja-JP")}・検出 {run.matchedCount}件</small></div><button type="button" onClick={() => setTab("bots")}>履歴</button></article>) : <p>Botからの検知はありません。</p>}</section>
        </>}
        {tab === "access" && <>
          <CommunityAccessManagementControls communityId={communityId} memory={accessManagementMemory.current} isCurrent={isCurrentScope} onChanged={()=>void load()} kinds={['invites']}/>
          <section>
            <header><h3>カスタム役職</h3><small>{data.customRoles.length}件</small></header>
            {data.role === "owner" && <div className="community-operations__form">
              <input value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder="役職名" />
              <button disabled={busy || !roleName.trim()} onClick={() => void act({ action: "create_role", name: roleName, canManagePosts: true }).then((completed) => { if (completed) setRoleName(""); })}>作成</button>
            </div>}
            {data.customRoles.map((role) => {
              const assignedMembers = data.members.filter((member) => member.customRoleIds?.split(",").includes(role.id));
              const unassignedMembers = data.members.filter((member) => !member.customRoleIds?.split(",").includes(role.id));
              const threshold = autoRoleThresholds[role.id] ?? "10";
              return <article className="community-operations__role" key={role.id}>
                <div>
                  <strong>{role.name}</strong>
                  <small>{[role.canManageChannels && "チャンネル", role.canManagePosts && "投稿", role.canManageMembers && "メンバー", role.canManageGuides && "ページ"].filter(Boolean).join("・") || "追加権限なし"}</small>
                  {assignedMembers.length > 0 && <span>{assignedMembers.map((member) => <button key={member.profileId} type="button" disabled={busy || data.role !== "owner"} onClick={() => requestCritical({ action: "assign_role", title: "役職の割り当てを解除", target: `${member.displayName}の役職「${role.name}」`, impact: "この役職から付与される権限を直ちに解除します。メンバー資格自体は維持されます。", payload: { roleId: role.id, profileId: member.profileId, assigned: false } })}>{member.displayName}・解除</button>)}</span>}
                </div>
                <div className="community-operations__role-controls">
                  {data.role === "owner" && <label>メンバー
                    <select defaultValue="" onChange={(event) => {
                      const profileId = event.target.value;
                      const member = data.members.find((item) => item.profileId === profileId);
                      if (profileId && member) requestCritical({ action: "assign_role", title: "役職を割り当て", target: `${member.displayName}へ役職「${role.name}」`, impact: "この役職に設定された権限を対象メンバーへ付与します。", payload: { roleId: role.id, profileId, assigned: true } });
                      event.target.value = "";
                    }}>
                      <option value="">割り当てる…</option>
                      {unassignedMembers.map((member) => <option key={member.profileId} value={member.profileId}>{member.displayName}</option>)}
                    </select>
                  </label>}
                  {data.role === "owner" && <label>投稿数
                    <input type="number" min="1" step="1" value={threshold} onChange={(event) => setAutoRoleThresholds((current) => ({ ...current, [role.id]: event.target.value }))} />
                    <button type="button" disabled={busy || !Number.isFinite(Number(threshold)) || Number(threshold) <= 0} onClick={() => requestCritical({ action: "create_auto_role_rule", title: "役職の自動付与を開始", target: `役職「${role.name}」`, impact: `投稿数が${threshold}件に達したメンバーへ、この役職と権限を自動で付与します。`, payload: { roleId: role.id, criterion: "message_count", threshold } })}>自動付与</button>
                  </label>}
                  {data.role === "owner" && <button className="is-danger" disabled={busy} onClick={() => requestCritical({ action: "delete_role", title: "役職を削除", target: `役職「${role.name}」`, impact: "この役職のメンバー割り当て、自動付与ルール、チャンネル権限も解除されます。元に戻せません。", payload: { roleId: role.id } })}>役職を削除</button>}
                </div>
              </article>;
            })}
            {data.autoRoleRules.map((rule) => <article key={rule.id}><div><strong>{rule.roleName}を自動付与</strong><small>{rule.criterion}：{rule.threshold}</small></div><button disabled={busy || data.role !== "owner"} onClick={() => requestCritical({ action: "delete_auto_role_rule", title: "役職の自動付与を解除", target: `役職「${rule.roleName}」`, impact: `基準「${rule.criterion}：${rule.threshold}」による今後の自動付与を停止します。すでに付与された役職は維持されます。`, payload: { ruleId: rule.id } })}>解除</button></article>)}
          </section>
          <CommunityChannelPolicyControls communityId={communityId} memory={channelPolicyMemory.current} isCurrent={isCurrentScope} onChanged={()=>void load()}/>
          <CommunityRemoteParticipationControls communityId={communityId}/>
          <CommunityChannelAccessGates channels={data.channels}/>
          <section>
            <header><div><h3>チャンネル権限表</h3><small>役職ごとに閲覧・投稿・管理を設定</small></div></header>
            {data.customRoles.length && data.channels.length ? <div className="community-permission-matrix">
              <table>
                <thead><tr><th>役職 / チャンネル</th>{data.channels.map((channel) => <th key={channel.id}>#{channel.name}</th>)}</tr></thead>
                <tbody>{data.customRoles.map((role) => <tr key={role.id}><th>{role.name}</th>{data.channels.map((channel) => {
                  const permission = data.permissions.find((item) => item.roleId === role.id && item.channelId === channel.id);
                  const state = { canView: permission?.canView !== 0, canPost: permission?.canPost !== 0, canManage: permission?.canManage === 1 };
                  const update = (key: keyof typeof state) => {
                    const next = { ...state, [key]: !state[key] };
                    if (key === "canView" && !next.canView) {
                      next.canPost = false;
                      next.canManage = false;
                    }
                    requestCritical({
                      action: "channel_permission",
                      title: "チャンネル権限を変更",
                      target: `役職「${role.name}」の#${channel.name}`,
                      impact: `閲覧 ${state.canView ? "可" : "不可"}→${next.canView ? "可" : "不可"}、投稿 ${state.canPost ? "可" : "不可"}→${next.canPost ? "可" : "不可"}、管理 ${state.canManage ? "可" : "不可"}→${next.canManage ? "可" : "不可"}へ変更します。`,
                      payload: { roleId: role.id, channelId: channel.id, ...next },
                    });
                  };
                  return <td key={channel.id}><label><input type="checkbox" checked={state.canView} onChange={() => update("canView")} />見る</label><label><input type="checkbox" checked={state.canPost} disabled={!state.canView} onChange={() => update("canPost")} />投稿</label><label><input type="checkbox" checked={state.canManage} disabled={!state.canView} onChange={() => update("canManage")} />管理</label></td>;
                })}</tr>)}</tbody>
              </table>
            </div> : <p>役職とチャンネルを作成すると権限表が表示されます。</p>}
          </section>
        </>}
        {tab === "rules" && <CommunityAccessManagementControls communityId={communityId} memory={accessManagementMemory.current} isCurrent={isCurrentScope} onChanged={()=>void load()} kinds={['rules','questions']}/>}
        {tab === "infrastructure" && <CommunityInfrastructurePanel />}
        {tab === "bots" && <>
          <section>
            <header><h3>コミュニティBot</h3><small>{data.bots.filter((bot) => bot.enabled).length}件稼働</small></header>
            <p>Botは情報の検知と運営への通知を行います。投稿削除やメンバー処分は自動実行しません。</p>
            {data.role === "owner" && <div className="community-operations__stack">
              <input value={botName} maxLength={40} onChange={(event) => setBotName(event.target.value)} placeholder="Bot名" aria-label="Bot名" />
              <select value={botKind} onChange={(event) => setBotKind(event.target.value as typeof botKind)} aria-label="Botの種類">
                <option value="welcome">参加案内</option><option value="moderation">モデレーション検知</option><option value="guide_watch">共同ページ再検証</option><option value="governance">DAO通知</option><option value="recruitment">募集確認</option><option value="digest">週間ダイジェスト</option>
              </select>
              <select value={botChannelId} onChange={(event) => setBotChannelId(event.target.value)} aria-label="Botの通知先">
                <option value="">通知先チャンネルを選択</option>{data.channels.filter((channel) => !channel.archivedAt).map((channel) => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}
              </select>
              <button disabled={busy || !botName.trim() || !botChannelId} onClick={() => void act({ action: "create_bot", name: botName, kind: botKind, channelId: botChannelId }).then((completed) => { if (completed) setBotName(""); })}>Botを追加</button>
            </div>}
            {data.bots.length ? data.bots.map((bot) => <article key={bot.id}>
              <div><strong>{bot.name} <small>BOT</small></strong><p>{({ welcome: "参加案内", moderation: "通報の検知", guide_watch: "共同ページの再検証", governance: "DAOの進行確認", recruitment: "募集中投稿の確認", digest: "週間ダイジェスト" } as const)[bot.kind]}</p><small>#{bot.channelName ?? "通知先なし"}・{bot.enabled ? "稼働中" : "停止中"}</small></div>
              {data.role === "owner" && <span><button disabled={busy} onClick={() => void act({ action: "run_bot", botId: bot.id })}>今すぐ実行</button><button disabled={busy} onClick={() => void act({ action: "update_bot", botId: bot.id, enabled: !bot.enabled })}>{bot.enabled ? "停止" : "再開"}</button><button className="is-danger" disabled={busy} onClick={() => requestCritical({ action: "delete_bot", title: "Botを削除", target: `Bot「${bot.name}」`, impact: "このBotの設定と今後の実行を削除します。過去の監査履歴は保持します。削除後は元に戻せません。", payload: { botId: bot.id } })}>削除</button></span>}
            </article>) : <p>Botはまだ追加されていません。</p>}
          </section>
          <section><header><h3>Bot実行履歴</h3><small>最新50件</small></header>{data.botRuns.length ? data.botRuns.map((run) => <article key={run.id}><div><strong>{run.botName}・{run.status === "completed" ? "完了" : run.status === "skipped" ? "スキップ" : "失敗"}</strong><p>{run.summary}</p><small>{new Date(run.completedAt).toLocaleString("ja-JP")}・検出 {run.matchedCount}件</small></div></article>) : <p>実行履歴はありません。</p>}</section>
        </>}
        {tab === "insights" && <>
          <section className="community-operations__metrics"><header><h3>過去30日の運営指標</h3></header>{data.metrics.length ? data.metrics.map((metric) => <article key={metric.metricDay}><strong>{metric.metricDay}</strong><span>活動 {metric.activeMembers}</span><span>参加 {metric.joins}</span><span>投稿 {metric.posts}</span><span>通報 {metric.reports}</span></article>) : <p>集計は利用開始後に表示されます。</p>}</section>
          <section><header><h3>監査ログ</h3><small>最新100件</small></header>{data.audit.map((item) => <article key={item.id}><div><strong>{item.actorName}・{item.action}</strong><small>{item.targetName ? `${item.targetName}・` : ""}{new Date(item.createdAt).toLocaleString("ja-JP")}</small><p>{displayAuditDetail(item.detail)}</p></div></article>)}</section>
        </>}
        {tab === "safety" && <>
          <section><header><h3>警告・タイムアウト</h3><small>{data.members.length}人</small></header>{data.members.filter((member) => member.role !== "owner").map((member) => <article key={member.profileId}><div><strong>{member.displayName}</strong><small>{member.role}・{member.status === "muted" ? "投稿停止中" : "有効"}</small></div><span><button disabled={busy} onClick={() => requestCritical({ action: "member_action", title: "メンバーへ警告", target: member.displayName, impact: "警告理由を運営履歴に記録します。投稿権限は変更しません。", payload: { memberAction: "warn", profileId: member.profileId } })}>警告</button>{member.status === "muted" ? <button disabled={busy} onClick={() => requestCritical({ action: "member_action", title: "投稿停止を解除", target: member.displayName, impact: "このメンバーの投稿権限を直ちに有効へ戻します。", payload: { memberAction: "remove_timeout", profileId: member.profileId } })}>停止を解除</button> : <button disabled={busy} onClick={() => requestCritical({ action: "member_action", title: "24時間の投稿停止", target: member.displayName, impact: "このメンバーのコミュニティ内での投稿を24時間停止します。処分への異議申立ては引き続き利用できます。", payload: { memberAction: "timeout", profileId: member.profileId, hours: 24 } })}>24時間停止</button>}</span></article>)}</section>
          <section><header><h3>公式認証を申請</h3></header><textarea value={verificationReason} onChange={(event) => setVerificationReason(event.target.value)} placeholder="公式性、代表者、公開活動について20文字以上で説明" /><button disabled={busy || verificationReason.trim().length < 20 || data.role !== "owner"} onClick={() => void act({ action: "request_verification", reason: verificationReason })}>審査を申請</button></section>
          <section className="community-operations__danger"><header><h3>コミュニティを閉鎖</h3></header><p>新規参加と投稿を停止するための手続きです。データは即時削除しません。</p><input value={closeName} onChange={(event) => setCloseName(event.target.value)} placeholder={communityName} /><button disabled={busy || closeName !== communityName || data.role !== "owner"} onClick={() => requestCritical({ action: "close", title: "コミュニティを閉鎖", target: `コミュニティ「${communityName}」`, impact: "新規参加と新しい投稿を停止します。既存データは削除せず保持しますが、閉鎖後の再開には運営上の復旧手続きが必要です。", payload: { confirmName: closeName } })}>名前を確認して閉鎖</button></section>
        </>}
      </div> : null}
      {activeReceipt && <section className="community-operations__receipt" aria-label="操作レシート">
        <strong>操作を記録しました</strong>
        <span>{activeReceipt.targetLabel}</span>
        <span>監査番号: {activeReceipt.auditId}</span>
        <span>実行日時: {new Date(activeReceipt.confirmedAt).toLocaleString("ja-JP")}</span>
        {activeReceipt.replayed && <span>同じ操作IDの結果を再表示しています。</span>}
        {activeReceipt.membershipEffect && <span>{activeReceipt.membershipEffect==="unmuted"?"対象の投稿停止を解除しました。":"メンバー状態は変更していません。"}</span>}
      </section>}
      {activeNotificationRetry && <section className="community-operations__receipt" aria-label="通報結果の通知">
        <span>判断は保存済みです。通報者への通知は未完了です。</span>
        <button type="button" disabled={busy} onClick={()=>void act(activeNotificationRetry.body,false)}>通知を再試行</button>
      </section>}
      {activePendingCritical && <div className="moderation-operation-backdrop">
        <section className="moderation-operation-dialog" role="dialog" aria-modal="true" aria-labelledby="community-critical-title">
          <h2 id="community-critical-title">{activePendingCritical.title}</h2>
          <dl>
            <div><dt>対象</dt><dd>{activePendingCritical.target}</dd></div>
            <div><dt>影響</dt><dd>{activePendingCritical.impact}</dd></div>
          </dl>
          <label>
            判断理由（5文字以上）
            <textarea autoFocus value={criticalNote} maxLength={1000} disabled={busy} onChange={(event) => {setCriticalNote(event.target.value);setPendingCritical(current=>current && ["membership","resolve_report","resolve_appeal"].includes(current.action)?{...current,operationId:crypto.randomUUID()}:current);}} placeholder="変更理由や運営上の判断を記録" />
          </label>
          <div>
            <button type="button" disabled={busy} onClick={() => setPendingCritical(null)}>キャンセル</button>
            <button type="button" className="is-danger" disabled={busy || criticalNote.trim().length < 5} onClick={() => void confirmCritical()}>
              {busy ? "処理中…" : "確認して実行"}
            </button>
          </div>
        </section>
      </div>}
    </section>
  </div>;
}
