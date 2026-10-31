import type { Metadata } from "next";

import { V2Empty } from "@/components/v2/v2-empty";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

import "../../v2.css";
import styles from "./library.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "広告ライブラリ | Hub v2" };

type LibraryRow = { id: string; headline: string; description: string | null; callToAction: string; landingUrl: string; advertiserDisplayName: string; format: string; firstServedDay: string; lastServedDay: string };

type LibraryResult = { rows: LibraryRow[]; failed: boolean };

async function loadLibrary(): Promise<LibraryResult> {
  let database: ReturnType<typeof getOptionalHubD1>;
  try {
    database = getOptionalHubD1();
  } catch {
    return { rows: [], failed: true };
  }
  if (!database) return { rows: [], failed: true };

  try {
    const result = await database.prepare(`SELECT cv.id,cv.headline,cv.description,cv.call_to_action callToAction,
      cv.landing_url landingUrl,cv.advertiser_display_name advertiserDisplayName,cr.format,
      MIN(r.report_day) firstServedDay,MAX(r.report_day) lastServedDay
      FROM hub_ad_creative_versions cv JOIN hub_ad_creatives cr ON cr.id=cv.creative_id
      JOIN hub_ad_daily_reports r ON r.creative_version_id=cv.id
      WHERE cv.review_status IN ('approved','approved_with_restrictions') AND cr.status IN ('approved','paused')
        AND r.served_count>0 GROUP BY cv.id ORDER BY lastServedDay DESC LIMIT 200`).all<LibraryRow>();
    if (result.success !== true) return { rows: [], failed: true };
    return { rows: result.results, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

/* 実際に配信された広告の公開一覧。問い合わせは既存の /advertising/library と同じ。 */
export default async function V2AdvertisingLibraryPage() {
  const { rows, failed } = await loadLibrary();
  return (
    <V2PanelPage currentPath="/v2/advertising" title="広告ライブラリ" note={failed ? undefined : `${rows.length}件`}>
      <p className={styles.intro}>Hubで実際に配信された広告です。個人別の履歴やターゲティングは表示しません。</p>
      {failed ? (
        <V2Empty title="広告ライブラリを読み込めませんでした" action={{ label: "再試行", href: "/v2/advertising/library" }} />
      ) : rows.length ? (
        <ul className={styles.grid}>
          {rows.map((row) => (
            <li key={row.id} className={styles.card}>
              <small className={styles.eyebrow}><span>広告 · {row.advertiserDisplayName}</span><span>{row.format}</span></small>
              <strong className={styles.title}>{row.headline}</strong>
              {row.description ? <p className={styles.desc}>{row.description}</p> : null}
              <span className={styles.foot}>
                <span>{row.firstServedDay}〜{row.lastServedDay}</span>
                <a href={row.landingUrl} rel="sponsored noreferrer">{row.callToAction}</a>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <V2Empty title="公開中の広告はありません" />
      )}
    </V2PanelPage>
  );
}
