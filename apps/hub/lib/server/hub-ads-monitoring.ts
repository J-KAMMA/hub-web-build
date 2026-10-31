import type { D1Database } from "@cloudflare/workers-types";

type Alert = { key: string; severity: "warning" | "critical"; category: "delivery" | "budget" | "scanner" | "payment" | "reporting"; summary: string };

export async function evaluateHubAdOperationalAlerts(database: D1Database, now = Date.now()) {
  const [scanner, payment, reporting, budget] = await database.batch([
    database.prepare(`SELECT COUNT(*) count FROM hub_ad_image_assets WHERE status IN ('quarantined','scanning') AND created_at < ?`).bind(now - 30 * 60_000),
    database.prepare(`SELECT COUNT(*) count FROM hub_ad_x402_deposits WHERE status IN ('failed','expired') AND updated_at >= ?`).bind(now - 24 * 60 * 60_000),
    database.prepare("SELECT MAX(updated_at) latest FROM hub_ad_daily_reports"),
    database.prepare(`SELECT COUNT(*) count FROM hub_ad_campaigns c WHERE c.status='active' AND
      COALESCE((SELECT SUM(amount_jpy_micros) FROM hub_ad_budget_ledger b WHERE b.campaign_id=c.id),0) >= c.total_budget_jpy_micros`),
  ]);
  const count = (result: typeof scanner) => Number((result.results[0] as { count?: number } | undefined)?.count ?? 0);
  const alerts: Alert[] = [];
  if (count(scanner)) alerts.push({ key: "scanner.stalled", severity: "critical", category: "scanner", summary: `${count(scanner)}件の広告画像スキャンが30分以上停止しています。` });
  if (count(payment)) alerts.push({ key: "payment.failures.24h", severity: "warning", category: "payment", summary: `直近24時間に${count(payment)}件の広告入金失敗または期限切れがあります。` });
  const latest = Number((reporting.results[0] as { latest?: number } | undefined)?.latest ?? 0);
  if (latest && latest < now - 48 * 60 * 60_000) alerts.push({ key: "reporting.stale", severity: "critical", category: "reporting", summary: "広告レポートが48時間以上更新されていません。" });
  if (count(budget)) alerts.push({ key: "budget.exhausted", severity: "warning", category: "budget", summary: `${count(budget)}件の配信中キャンペーンが予算上限に達しています。` });
  for (const alert of alerts) await database.prepare(`INSERT INTO hub_ad_operational_alerts
    (id,alert_key,severity,category,summary,status,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?)
    ON CONFLICT(alert_key) DO UPDATE SET severity=excluded.severity,category=excluded.category,summary=excluded.summary,status='open',updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), alert.key, alert.severity, alert.category, alert.summary, now, now).run();
  return alerts;
}

export async function listHubAdOperationalAlerts(database: D1Database) {
  return (await database.prepare(`SELECT id,alert_key alertKey,severity,category,summary,status,created_at createdAt,updated_at updatedAt
    FROM hub_ad_operational_alerts WHERE status!='resolved' ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,updated_at DESC LIMIT 100`).all()).results;
}

export async function getHubAdOperationalHealth(database: D1Database) {
  const [campaigns, pendingReview, pendingAssets, lastReport] = await database.batch([
    database.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active FROM hub_ad_campaigns`),
    database.prepare("SELECT COUNT(*) count FROM hub_ad_campaigns WHERE review_status='pending'"),
    database.prepare("SELECT COUNT(*) count FROM hub_ad_image_assets WHERE status IN ('quarantined','scanning')"),
    database.prepare("SELECT MAX(updated_at) latest FROM hub_ad_daily_reports"),
  ]);
  const first = (result: typeof campaigns) => result.results[0] as Record<string, unknown> | undefined;
  return { campaigns: Number(first(campaigns)?.total ?? 0), activeCampaigns: Number(first(campaigns)?.active ?? 0),
    pendingReview: Number(first(pendingReview)?.count ?? 0), pendingAssets: Number(first(pendingAssets)?.count ?? 0),
    lastReportAt: Number(first(lastReport)?.latest ?? 0) || null };
}
