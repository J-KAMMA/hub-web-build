import { cookies } from "next/headers";

import { AdminAccessRequired } from "@/components/admin-access-required";
import { HubTokenEconomicsSimulator } from "@/components/hub-token-economics-simulator";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";
import { readHubTokenReadiness } from "@/lib/server/hub-token-readiness";

const status = (ok: boolean) => ok ? "正常" : "要確認";

export default async function HubTokenAdminPage() {
  const token = (await cookies()).get(MODERATION_ADMIN_COOKIE)?.value;
  if (!isModerationAdminToken(token)) return <AdminAccessRequired />;
  const readiness = await readHubTokenReadiness().catch(() => null);
  return <>
    <section className="feature-panel feature-panel--standalone" aria-labelledby="hub-token-operation-title">
      <div className="feature-panel__heading"><div><span>OPERATIONS</span><h1 id="hub-token-operation-title">Hub Token 運用状態</h1></div><strong>{readiness?.ok ? "正常" : "要確認"}</strong></div>
      {readiness ? <>
        <dl className="balance-grid">
          <div><dt>発行待ち</dt><dd>{readiness.pendingRevenueCount}</dd></div>
          <div><dt>審査待ち</dt><dd>{readiness.reviewRevenueCount}</dd></div>
          <div><dt>取消待ち</dt><dd>{readiness.pendingRefundCount}</dd></div>
          <div><dt>チェックポイント待ち</dt><dd>{readiness.pendingCheckpointCount}</dd></div>
          <div><dt>最新エポック</dt><dd>{readiness.latestCheckpointEpoch}</dd></div>
        </dl>
        <dl className="balance-grid">
          <div><dt>正確台帳世代</dt><dd>{status(readiness.generationActive)}</dd></div>
          <div><dt>会計照合</dt><dd>{status(readiness.reconciliationOk)}</dd></div>
          <div><dt>オンチェーン整合性</dt><dd>{status(readiness.onchainOk && readiness.onchainEnvironmentOk)}</dd></div>
          <div><dt>Bearer権限分離</dt><dd>{status(readiness.scopeTokensOk)}</dd></div>
          <div><dt>HMAC権限分離</dt><dd>{status(readiness.issuerSecretsOk)}</dd></div>
        </dl>
      </> : <p role="alert">台帳の運用状態を取得できませんでした。読み取り設定と台帳の稼働状態を確認してください。</p>}
      {readiness?.latestCheckpointSubmittedAt ? <p>最終チェックポイント送信: {new Date(readiness.latestCheckpointSubmittedAt).toLocaleString("ja-JP")}</p> : null}
      <p>この画面は読み取り専用です。発行、取消、設定変更は実行しません。</p>
    </section>
    <HubTokenEconomicsSimulator />
  </>;
}
