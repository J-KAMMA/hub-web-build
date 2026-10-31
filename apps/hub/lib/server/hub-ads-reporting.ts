import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

const DAY_MS = 86_400_000;
const RAW_RETENTION_DAYS = 30;
const REPORT_RETENTION_DAYS = 400;
export const HUB_AD_REPORT_PRIVACY_THRESHOLD = 100;

function utcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function aggregateHubAdReports(database: D1Database, now = Date.now()) {
  const currentDayStart = Date.parse(`${utcDay(now)}T00:00:00.000Z`);
  const rebuildFrom = currentDayStart - RAW_RETENTION_DAYS * DAY_MS;
  await database.prepare(`
    INSERT INTO hub_ad_daily_reports
      (report_day, campaign_id, line_item_id, placement_id, creative_version_id,
       selected_count, served_count, rendered_count, viewable_count, clicked_count, invalid_count, filtered_count,
       spend_jpy_micros, updated_at)
    SELECT date(me.occurred_at / 1000, 'unixepoch'), li.campaign_id, me.line_item_id, me.placement_id, me.creative_version_id,
      SUM(me.event_type = 'selected'), SUM(me.event_type = 'served'), SUM(me.event_type = 'rendered'),
      SUM(me.event_type = 'viewable'), SUM(me.event_type = 'clicked'), SUM(me.event_type = 'invalid'),
      SUM(me.event_type = 'filtered'),
      COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl
        WHERE bl.line_item_id = me.line_item_id
          AND date(bl.occurred_at / 1000, 'unixepoch') = date(me.occurred_at / 1000, 'unixepoch')), 0), ?
    FROM hub_ad_measurement_events me
    JOIN hub_ad_line_items li ON li.id = me.line_item_id
    WHERE me.occurred_at >= ? AND me.occurred_at < ?
    GROUP BY report_day, li.campaign_id, me.line_item_id, me.placement_id, me.creative_version_id
    ON CONFLICT(report_day, line_item_id, placement_id, creative_version_id) DO UPDATE SET
      selected_count = excluded.selected_count, served_count = excluded.served_count,
      rendered_count = excluded.rendered_count, viewable_count = excluded.viewable_count,
      clicked_count = excluded.clicked_count, invalid_count = excluded.invalid_count,
      filtered_count = excluded.filtered_count, spend_jpy_micros = excluded.spend_jpy_micros,
      updated_at = excluded.updated_at
  `).bind(now, rebuildFrom, currentDayStart).run();

  const anomalies = await database.prepare(`
    SELECT report_day, campaign_id, line_item_id,
      SUM(served_count) served_count, SUM(rendered_count) rendered_count,
      SUM(viewable_count) viewable_count, SUM(clicked_count) clicked_count,
      SUM(invalid_count) invalid_count
    FROM hub_ad_daily_reports
    WHERE report_day >= date(?, 'unixepoch')
    GROUP BY report_day, campaign_id, line_item_id
  `).bind(rebuildFrom / 1000).all<{ report_day: string; campaign_id: string; line_item_id: string; served_count: number; rendered_count: number; viewable_count: number; clicked_count: number; invalid_count: number }>();
  let flagsCreated = 0;
  for (const row of anomalies.results) {
    const reasons: Array<[string, "medium" | "high", number, number]> = [];
    if (row.clicked_count > row.rendered_count) reasons.push(["clicks_exceed_rendered", "high", row.clicked_count, row.rendered_count]);
    else if (row.clicked_count > row.viewable_count) reasons.push(["clicks_exceed_viewable", "medium", row.clicked_count, row.viewable_count]);
    if (row.served_count >= HUB_AD_REPORT_PRIVACY_THRESHOLD && row.clicked_count * 100 > row.served_count * 30)
      reasons.push(["high_click_rate", "high", row.clicked_count, row.served_count]);
    if (row.invalid_count > 0) reasons.push(["event_sequence_mismatch", "medium", row.invalid_count, row.served_count]);
    for (const [reason, severity, observed, baseline] of reasons) {
      const result = await database.prepare(`INSERT OR IGNORE INTO hub_ad_traffic_reviews
        (id, report_day, campaign_id, line_item_id, reason_code, severity, observed_count, baseline_count, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
        .bind(crypto.randomUUID(), row.report_day, row.campaign_id, row.line_item_id, reason, severity, observed, baseline, now).run();
      flagsCreated += result.meta.changes ?? 0;
    }
  }
  return { reportsUpdated: anomalies.results.length, flagsCreated };
}

export async function pruneHubAdReportingData(database: D1Database, now = Date.now()) {
  const rawCutoff = now - RAW_RETENTION_DAYS * DAY_MS;
  const reportCutoff = utcDay(now - REPORT_RETENTION_DAYS * DAY_MS);
  const [events, reports, reviews] = await database.batch([
    database.prepare("DELETE FROM hub_ad_measurement_events WHERE occurred_at < ?").bind(rawCutoff),
    database.prepare("DELETE FROM hub_ad_daily_reports WHERE report_day < ?").bind(reportCutoff),
    database.prepare("DELETE FROM hub_ad_traffic_reviews WHERE report_day < ?").bind(reportCutoff),
  ]);
  return { eventsDeleted: events.meta.changes ?? 0, reportsDeleted: reports.meta.changes ?? 0, reviewsDeleted: reviews.meta.changes ?? 0 };
}

export async function runHubAdReportingMaintenance(database: D1Database, now = Date.now()) {
  const aggregated = await aggregateHubAdReports(database, now);
  const pruned = await pruneHubAdReportingData(database, now);
  return { ...aggregated, ...pruned };
}

export async function listHubAdReports(database: D1Database, days = 30, now = Date.now()) {
  const boundedDays = Math.max(1, Math.min(90, Math.trunc(days)));
  const fromDay = utcDay(now - (boundedDays - 1) * DAY_MS);
  const rows = await database.prepare(`
    SELECT r.report_day reportDay, r.campaign_id campaignId, c.campaign_name campaignName,
      SUM(r.served_count) served, SUM(r.rendered_count) rendered, SUM(r.viewable_count) viewable,
      SUM(r.clicked_count) clicked,
      COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl
        WHERE bl.campaign_id = r.campaign_id
          AND date(bl.occurred_at / 1000, 'unixepoch') = r.report_day), 0) spendJpyMicros
    FROM hub_ad_daily_reports r JOIN hub_ad_campaigns c ON c.id = r.campaign_id
    WHERE r.report_day >= ? GROUP BY r.report_day, r.campaign_id, c.campaign_name
    HAVING SUM(r.served_count) >= ? ORDER BY r.report_day DESC, c.campaign_name LIMIT 500
  `).bind(fromDay, HUB_AD_REPORT_PRIVACY_THRESHOLD).all();
  const reviews = await database.prepare(`SELECT id, report_day reportDay, campaign_id campaignId,
      line_item_id lineItemId, reason_code reasonCode, severity, observed_count observedCount,
      baseline_count baselineCount, status
    FROM hub_ad_traffic_reviews WHERE report_day >= ? ORDER BY report_day DESC, severity DESC LIMIT 200`)
    .bind(fromDay).all();
  return { rows: rows.results, reviews: reviews.results, privacyThreshold: HUB_AD_REPORT_PRIVACY_THRESHOLD };
}

function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createHubAdReportCsv(rows: ReadonlyArray<Record<string, unknown>>) {
  const columns = ["report_day", "campaign_id", "campaign_name", "served", "rendered", "viewable", "clicked", "spend_jpy_micros"];
  const keys = ["reportDay", "campaignId", "campaignName", "served", "rendered", "viewable", "clicked", "spendJpyMicros"];
  return `\uFEFF${columns.map(csvCell).join(",")}\r\n${rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")).join("\r\n")}\r\n`;
}
