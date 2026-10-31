import type { Metadata } from "next";
import { ResearchDiscovery } from '@/components/research-discovery';
import Link from "next/link";
import { V2TagChipRow } from "@/components/v2/v2-tag-chip";
import { notFound } from "next/navigation";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2ThreadBody } from "@/components/v2/v2-thread-body";
import { V2ThreadReply } from "@/components/v2/v2-thread-reply";
import { V2ThreadTracking } from "@/components/v2/v2-thread-tracking";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";
import { getThreadPageData } from "@/lib/server/thread-page-data";
import { WORKFLOW_LABELS } from "@/lib/thread-knowledge";
import { THREAD_LANGUAGE_LABELS, THREAD_REGION_LABELS } from "@/lib/thread-scope";
import { getThreadType, THREAD_TYPE_LABELS } from "@/lib/thread-type";
import { socialStreamReturnHref } from "@/lib/social-stream-return";

import "../../v2.css";
import "../../redesign-sns.css";
import "../../v2-luxe.css";
import "../../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "スレッド | Hub v2",
};

const PAGE_SIZE = 50;

/*
 * v2 のスレッド詳細。データは既存の getThreadPageData をそのまま使う。
 * 既存の /threads/[id] には触れない。
 *
 * 落とさなかったもの: 投稿1件の要素（番号・作成者／選ばれた回答／役割／鮮度の札・
 * 編集済み／削除済み／運営非表示・返信先・伏せ・画像・反応・品質の投票・
 * 引用して返信・ベストアンサーの採用）、50件ずつのページ送り、フォロー・未読・
 * 既読、受付状態とスレッド状態（別軸）、統合先の案内、返信欄を出す条件
 * （open かつ 凍結でない かつ 統合されていない）、返信の下書きの共有。
 *
 * まだ無いもの: スレッド内検索、会話別の表示、要点ビュー、低速モードや
 * 状態の変更（管理）、関連スレッドの登録、番号メニュー、編集・削除・履歴。
 */
export default async function V2ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ page?: string | string[]; returnTo?: string | string[] }>;
}) {
  const { threadId } = await params;
  const query = await searchParams;
  const rawPage = query.page;
  const streamReturn = socialStreamReturnHref(query.returnTo), backHref = streamReturn ?? "/v2/bbs";
  const returnQuery = streamReturn ? `&returnTo=${encodeURIComponent(streamReturn)}` : "";
  const pageValue = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const requestedPage = Math.max(1, /^\d+$/.test(pageValue ?? "") ? Number(pageValue) : 1);
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const backLabel = streamReturn ? (japanese ? "タイムラインへ戻る" : "Back to timeline") : (japanese ? "スレッド一覧へ" : "All threads");

  const [{ currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount }, page] = await Promise.all([
    getAppShellData(),
    getThreadPageData(threadId, { limit: PAGE_SIZE, offset: (requestedPage - 1) * PAGE_SIZE, skipCounts: true }),
  ]);
  if (!page.thread) notFound();
  const thread = page.thread;
  const pageCount = Math.max(1, Math.ceil(thread.postCount / PAGE_SIZE));
  const currentPage = Math.min(pageCount, requestedPage);
  const type = getThreadType(thread);
  const canReply = (thread.status ?? "open") === "open"
    && thread.moderationStatus !== "frozen"
    && !thread.mergedIntoThreadId;

  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  /* 見出しの下は1行: 種類・返信数・状態・タグ。条件と関連スレッドは「絞り込み」の中。 */
  const summary = (
    <>
    <p className="v2-tinfo__row">
      <span className="v2-badge">{THREAD_TYPE_LABELS[type]}</span>
      <span>{japanese ? `返信 ${thread.postCount}` : `${thread.postCount} replies`}</span>
      {thread.solvedAt ? <span className="v2-badge v2-badge--best">{japanese ? "解決済み" : "Solved"}</span> : null}
      {(thread.status ?? "open") !== "open"
        ? <span className="v2-badge v2-badge--warn">{thread.status === "archived" ? (japanese ? "過去ログ" : "Archived") : (japanese ? "受付終了" : "Closed")}</span>
        : null}
      {thread.moderationStatus === "frozen" ? <span className="v2-badge v2-badge--warn">{japanese ? "運営凍結" : "Frozen"}</span> : null}
    </p>
    <V2TagChipRow tags={thread.tags} kind="threads" label={japanese ? "タグ" : "Tags"} />
    </>
  );

  const hasConditions = Boolean(thread.language || thread.region || thread.allowedCountryCodes?.length || thread.slowModeSeconds || page.workflowState !== "open");
  const details = hasConditions || page.relatedThreads.length ? (
    <details className="v2-filter-disclosure v2-tinfo">
      <summary>{japanese ? "絞り込み" : "Filter"}</summary>
      <div className="v2-filter-disclosure__body">
        {hasConditions ? (
          <>
            <p className="v2-column__title">{japanese ? "投稿条件" : "Conditions"}</p>
            <p className="v2-tinfo__conditions">
              {thread.language ? <span>{japanese ? "言語：" : "Language: "}{(thread.allowedLanguages ?? [thread.language]).map((value) => THREAD_LANGUAGE_LABELS[value]).join("・")}</span> : null}
              {thread.region ? <span>{japanese ? "地域：" : "Region: "}{THREAD_REGION_LABELS[thread.region]}</span> : null}
              {thread.allowedCountryCodes?.length ? <span>{japanese ? "対象国：" : "Countries: "}{thread.allowedCountryCodes.join("・")}</span> : null}
              {thread.slowModeSeconds ? <span>{japanese ? "低速モード " : "Slow mode "}{thread.slowModeSeconds >= 60 ? `${thread.slowModeSeconds / 60}${japanese ? "分" : "m"}` : `${thread.slowModeSeconds}${japanese ? "秒" : "s"}`}</span> : null}
              {page.workflowState !== "open" ? <span>{WORKFLOW_LABELS[page.workflowState]}</span> : null}
            </p>
          </>
        ) : null}
        {page.relatedThreads.length ? (
          <>
            <p className="v2-column__title">{japanese ? "関連するスレッド" : "Related"}</p>
            <ul className="v2-nav__list">
              {page.relatedThreads.map((item) => (
                <li key={item.id}>
                  <Link className="v2-nav__item" href={`/v2/threads/${item.id}${streamReturn ? `?returnTo=${encodeURIComponent(streamReturn)}` : ""}`}>
                    <span className="v2-nav__label">{item.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  ) : null;

  return (
    <V2Shell skin="luxe"
      currentPath={`/v2/threads/${threadId}`}
      profile={currentProfile}
      items={items}
      directoryTitle={japanese ? "この話題" : "This thread"}
      aside={
        <V2Aside
          posts={socialPosts}
          japanese={japanese}
          signedIn={Boolean(currentProfile.id)} viewerId={currentProfile.id}
          title={japanese ? "並べて見る" : "Alongside"}
        />
      }
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={thread.title}
        action={<>
          {page.authenticated ? (
            <V2ThreadTracking
              threadId={thread.id}
              following={page.tracking?.following ?? false}
              lastReadPostNo={page.tracking?.lastReadPostNo ?? 0}
              postCount={thread.postCount}
              japanese={japanese}
            />
          ) : null}
          <Link className="v2-heading__note" href={backHref}>{streamReturn ? backLabel : japanese ? "← スレッド一覧" : "← All threads"}</Link>
        </>}
      />
      {summary}
      {details}

      {thread.mergedIntoThreadId ? (
        <p className="v2-error" role="status">
          {japanese ? "このスレッドは統合されました。" : "This thread was merged."}{" "}
          <Link className="v2-card__link" href={`/v2/threads/${thread.mergedIntoThreadId}${streamReturn ? `?returnTo=${encodeURIComponent(streamReturn)}` : ""}`}>
            {japanese ? "統合先を見る →" : "Open the merged thread →"}
          </Link>
        </p>
      ) : null}

      <V2ThreadBody
        threadId={thread.id}
        posts={page.posts}
        threadAuthorId={page.posts[0]?.authorProfileId ?? null}
        bestAnswerPostId={thread.bestAnswerPostId ?? null}
        canPickBestAnswer={type === "question" && page.canManageThread}
        authenticated={page.authenticated}
        lastReadPostNo={page.tracking?.lastReadPostNo ?? 0}
        locale={locale}
      />

      {pageCount > 1 ? (
        <nav className="v2-pager" aria-label={japanese ? "返信のページ" : "Reply pages"}>
          {currentPage > 1 ? <Link className="v2-toggle v2-toggle--text" href={`/v2/threads/${thread.id}?page=${currentPage - 1}${returnQuery}`}>{japanese ? "← 前の50件" : "← Previous 50"}</Link> : null}
          <span className="v2-pager__label">{currentPage} / {pageCount}</span>
          {currentPage < pageCount ? <Link className="v2-toggle v2-toggle--text" href={`/v2/threads/${thread.id}?page=${currentPage + 1}${returnQuery}`}>{japanese ? "次の50件 →" : "Next 50 →"}</Link> : null}
        </nav>
      ) : null}

      {canReply ? (
        <V2ThreadReply
          threadId={thread.id}
          page={currentPage}
          returnTo={streamReturn ?? undefined}
          authenticated={page.authenticated}
          language={thread.allowedLanguages?.[0] ?? thread.language ?? "ja"}
          region={thread.region ?? "global"}
          languageTag={thread.allowedLanguageTags?.[0] ?? "ja-JP"}
          countryCode={thread.allowedCountryCodes?.[0] ?? null}
          allowedLanguages={thread.allowedLanguages ?? [thread.language ?? "ja"]}
          allowedLanguageTags={thread.allowedLanguageTags ?? ["ja-JP"]}
          allowedCountryCodes={thread.allowedCountryCodes ?? []}
          postTargets={page.posts.filter((post) => !post.deletedAt && !post.moderatedAt && !post.viewerMuted && !post.viewerBlocked).map((post) => ({ id: post.id, no: post.no }))}
          japanese={japanese}
        />
      ) : (
        <p className="v2-note" role="status">
          {thread.status === "archived"
            ? (japanese ? "このスレッドは過去ログです。投稿内容は引き続き閲覧・検索できます。" : "This thread is archived. Posts remain readable and searchable.")
            : (japanese ? "このスレッドは返信受付を終了しました。投稿内容は引き続き閲覧・検索できます。" : "This thread is closed to replies. Posts remain readable and searchable.")}
        </p>
      )}
      <ResearchDiscovery kind="thread" targetId={thread.id} sourceContext={{page:currentPage,returnTo:streamReturn??undefined}}/>
    </V2Shell>
  );
}
