import type { Metadata } from "next";
import Link from "next/link";

import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { V2State } from "@/components/v2/v2-state";
import { loadAuthorArticleStats, STATS_DAYS } from "@/lib/server/d1-user-article-stats";
import { loadAuthorArticleTipCounts } from "@/lib/server/article-tips";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

import "../../v2.css";
import "./stats.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "記事の統計 | Hub v2", robots: { index: false } };

/* 書き手本人だけが見る、直近30日の日別の閲覧数といいね数。流入元と個人の履歴は持たない。 */
export default async function V2ArticleStatsPage() {
  const shell = await getAppShellData();
  const viewerId = shell.currentProfile.id || null;
  const database = getOptionalHubD1();
  const rows = viewerId && database ? await loadAuthorArticleStats(database, viewerId).catch(() => []) : [];

  /* 応援（投げ銭）の件数。数だけ。表が無い環境では0件として出す。 */
  const tipCounts = viewerId && database ? await loadAuthorArticleTipCounts(database, viewerId).catch(() => new Map<string, number>()) : new Map<string, number>();

  return (
    <V2PanelPage wide currentPath="/v2/articles" title="記事の統計">
      <div className="v2-article-stats">
        <p className="v2-article-stats__note">
          直近{STATS_DAYS}日の、日ごとの閲覧数といいね数の合計です。見られるのは書き手本人だけで、読んだ人や流入元は記録しません。自分の閲覧は数えません。
        </p>
        {!viewerId ? (
          <V2State kind="signedOut" next="/v2/articles/stats" title="ログインすると、自分の記事の統計を見られます。" />
        ) : rows.length === 0 ? (
          <V2State kind="empty" icon="edit" title="公開中の記事がまだありません。" action={{ label: "新しく書く", href: "/v2/articles/new" }} />
        ) : (
          <ul className="v2-article-stats__list">
            {rows.map((row) => {
              const peak = Math.max(1, ...row.days.map((d) => d.views));
              return (
                <li key={row.articleId} className="v2-article-stats__item">
                  <div className="v2-article-stats__head">
                    <Link className="v2-article-stats__title" href={`/v2/articles/${row.articleId}`}>{row.title}</Link>
                    <span className="v2-article-stats__totals">
                      <span>閲覧 <strong>{row.views}</strong></span>
                      <span>いいね <strong>{row.likes}</strong></span>
                      <span>応援 <strong>{tipCounts.get(row.articleId) ?? 0}</strong></span>
                    </span>
                  </div>
                  <ol className="v2-article-stats__bars" aria-label={`${row.title} の日別の閲覧数`}>
                    {row.days.map((d) => (
                      <li
                        key={d.day}
                        className="v2-article-stats__bar"
                        data-empty={d.views === 0}
                        style={d.views ? { height: `${Math.max(6, Math.round((d.views / peak) * 100))}%` } : undefined}
                        title={`${d.day}　閲覧 ${d.views}　いいね ${d.likes}`}
                      />
                    ))}
                  </ol>
                  <div className="v2-article-stats__axis"><span>{row.days[0].day}</span><span>{row.days[row.days.length - 1].day}</span></div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </V2PanelPage>
  );
}
