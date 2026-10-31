import type { Metadata } from "next";
import Link from "next/link";

import { LocalizedDateTime } from "@/components/localized-date-time";
import { ThreadSummaryReportButton } from "@/components/thread-summary-report-button";
import { TranslatedText } from "@/components/translated-text";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { getThreadPageData } from "@/lib/server/thread-page-data";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";
import "../../../v2-luxe.css";
import "../../../v2-luxe-social.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "要点 | スレッド | Hub v2" };

/*
 * スレッドの要点。既存の /threads/[id]/summary から機能だけを抜いた:
 * 先頭・選ばれた回答・評価2以上・注目3以上を要点に、反対意見か賛成2以上を「別の観点」に。
 * **評価は正しさを保証しない**旨と、自動生成の時刻、通報の札を落とさない。
 * 翻訳は既存の TranslatedText。
 */
export default async function V2ThreadSummaryPage({ params }: { params: Promise<{ threadId: string }> }) {
  const [{ threadId }, locale, shell] = await Promise.all([params, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const data = await getThreadPageData(threadId);
  const selected = data.posts
    .filter((post) => post.no === 1 || post.id === data.thread?.bestAnswerPostId || (post.voteSummary?.score ?? 0) >= 2 || (post.spotlightScore ?? 0) >= 3)
    .sort((left, right) => {
      if (left.no === 1) return -1;
      if (right.no === 1) return 1;
      if (left.id === data.thread?.bestAnswerPostId) return -1;
      if (right.id === data.thread?.bestAnswerPostId) return 1;
      return (right.voteSummary?.score ?? 0) - (left.voteSummary?.score ?? 0) || left.no - right.no;
    });
  const selectedIds = new Set(selected.map((post) => post.id));
  const minority = data.posts
    .filter((post) => post.no > 1 && !selectedIds.has(post.id) && (post.knowledge?.role === "counterpoint" || (post.voteSummary?.up ?? 0) >= 2))
    .sort((left, right) => (right.voteSummary?.up ?? 0) - (left.voteSummary?.up ?? 0))
    .slice(0, 3);
  const generatedAt = new Date().toISOString();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const postHref = (no: number) => `/v2/threads/${threadId}#post-${no}`;

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: `/v2/threads/${threadId}`, label: japanese ? "スレッドへ戻る" : "Back to the thread" }} japanese={japanese} />}
      currentPath={`/v2/threads/${threadId}`}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "要点" : "Summary"}
      directory={
        <ul className="v2-nav__list">
          {selected.map((post) => <li key={post.id}><a className="v2-nav__item" href={`#post-${post.no}`}><span className="v2-nav__label">#{post.no} {post.displayName}</span></a></li>)}
        </ul>
      }
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={data.thread ? data.thread.title : (japanese ? "要点" : "Summary")} action={<Link className="v2-card__link v2-main-controls--directory-fallback" href={`/v2/threads/${threadId}`}>{japanese ? "すべての返信" : "All replies"}</Link>} />
      {data.thread ? (
        <div className="v2-tbody">
          <p className="v2-note">{japanese ? "作成者が選んだ回答と注目された返信を、元の投稿へのリンク付きで案内します。評価は正しさを保証せず、このページも確定した結論ではありません。" : "Accepted and highlighted replies, linked to the originals. Votes do not guarantee correctness; this page is not a final conclusion."}</p>
          <p className="v2-post__time">{japanese ? "自動生成・最終更新 " : "Generated "}<LocalizedDateTime value={generatedAt} /> · {japanese ? `要点 ${selected.length}件` : `${selected.length} highlights`}</p>
          {selected.map((post) => (
            <article id={`post-${post.no}`} key={post.id} className="v2-tpost">
              <a className="v2-tpost__no" href={postHref(post.no)}>#{post.no}</a>
              <div className="v2-tpost__body">
                <header className="v2-post__header">
                  <span className="v2-post__name">{post.displayName}</span>
                  <span className="v2-post__time"><LocalizedDateTime value={post.createdAt} /></span>
                  {post.id === data.thread?.bestAnswerPostId ? <span className="v2-badge v2-badge--best">{japanese ? "✓ 選ばれた回答" : "✓ Accepted"}</span> : null}
                </header>
                <TranslatedText locale={locale} sourceLocale={data.thread?.language} targetId={post.id} targetType="thread_post" text={post.body} />
                <p className="v2-post__time">{japanese ? "スコア" : "Score"} {post.voteSummary?.score ?? post.spotlightScore ?? 0} · <a className="v2-card__link" href={postHref(post.no)}>{japanese ? "返信の流れを見る" : "See the replies"}</a></p>
              </div>
            </article>
          ))}
          {!selected.length ? <p className="v2-note">{japanese ? "要点として案内できる返信はまだありません。" : "No highlights yet."}</p> : null}
          {minority.length ? (
            <section className="v2-msec" aria-labelledby="v2-summary-minority">
              <header className="v2-msec__head"><h2 id="v2-summary-minority" className="v2-column__title v2-column__title--section">{japanese ? "別の観点・少数意見" : "Other views"}</h2><span className="v2-msec__note">{japanese ? "多数の評価だけで見落とさないため" : "So majority votes do not hide them"}</span></header>
              {minority.map((post) => (
                <article key={post.id} className="v2-tpost">
                  <a className="v2-tpost__no" href={postHref(post.no)}>#{post.no}</a>
                  <div className="v2-tpost__body">
                    <header className="v2-post__header"><span className="v2-post__name">{post.displayName}</span></header>
                    <TranslatedText locale={locale} sourceLocale={data.thread?.language} targetId={post.id} targetType="thread_post" text={post.body} />
                  </div>
                </article>
              ))}
            </section>
          ) : null}
          <ThreadSummaryReportButton threadId={threadId} />
        </div>
      ) : <p className="v2-note">{japanese ? "スレッドが見つかりません。" : "Thread not found."}</p>}
    </V2Shell>
  );
}
