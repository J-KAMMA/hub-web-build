import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2BookmarkedPost } from "@/components/v2/v2-bookmarked-post";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getBookmarksPageData } from "@/lib/server/bookmarks-page-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../redesign-sns.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ブックマーク | Hub v2",
};

/*
 * 保存したもの。既存の /bookmarks から機能だけを抜いた: 投稿・スレッド・返信の3種、
 * 件数、空のとき。投稿は v2 の投稿カードで出す（保存を外すのもそこから）。
 * スレッドと返信の行き先は v2 の画面へ。
 */
function toV2(href: string) {
  return href.replace(/^\/threads\//, "/v2/threads/").replace(/^\/posts\//, "/v2/posts/");
}

export default async function V2BookmarksPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const [shell, data] = await Promise.all([getAppShellData(), getBookmarksPageData()]);
  const signedIn = Boolean(shell.currentProfile.id);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const counts = {
    social: data.items.filter((item) => item.kind === "social").length,
    thread: data.items.filter((item) => item.kind === "thread").length,
    reply: data.items.filter((item) => item.kind === "reply").length,
  };

  const directory = (
    <ul className="v2-nav__list">
      <li><a className="v2-nav__item" href="#v2-bm-social"><span className="v2-nav__label">{japanese ? "投稿" : "Posts"}</span><span className="v2-nav__count v2-nav__count--quiet">{counts.social}</span></a></li>
      <li><a className="v2-nav__item" href="#v2-bm-thread"><span className="v2-nav__label">{japanese ? "スレッド" : "Threads"}</span><span className="v2-nav__count v2-nav__count--quiet">{counts.thread}</span></a></li>
      <li><a className="v2-nav__item" href="#v2-bm-reply"><span className="v2-nav__label">{japanese ? "返信" : "Replies"}</span><span className="v2-nav__count v2-nav__count--quiet">{counts.reply}</span></a></li>
    </ul>
  );

  return (
    <V2Shell
      currentPath="/v2/bookmarks"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ブックマーク" : "Bookmarks"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={signedIn} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "ブックマーク" : "Bookmarks"} action={<span className="v2-heading__note">{japanese ? `${data.items.length}件` : `${data.items.length}`}</span>} />
      {!signedIn ? (
        <V2State kind="signedOut" icon="bookmark" next="/v2/bookmarks" japanese={japanese} note={japanese ? "ログインすると保存したものが見られます。" : "Sign in to see your bookmarks."} />
      ) : !data.items.length ? (
        <V2Empty title={japanese ? "保存したものはまだありません" : "Nothing saved yet"} note={japanese ? "投稿や返信の保存の記号から足せます。" : "Use the save mark on posts and replies."} action={{ label: japanese ? "フィードへ" : "Go to the feed", href: "/v2" }} />
      ) : (
        <>
          <section id="v2-bm-social" className="v2-msec" aria-labelledby="v2-bm-social-title">
            <header className="v2-msec__head"><h2 id="v2-bm-social-title" className="v2-column__title v2-column__title--section">{japanese ? "投稿" : "Posts"}</h2><span className="v2-msec__note">{counts.social}</span></header>
            {counts.social ? (
              <div className="v2-feed">
                {data.items.map((item) => item.kind === "social" ? (
                  <V2BookmarkedPost key={item.id} post={item.post} viewerId={shell.currentProfile.id} locale={locale} />
                ) : null)}
              </div>
            ) : <p className="v2-note">{japanese ? "保存した投稿はありません。" : "No saved posts."}</p>}
          </section>
          <section id="v2-bm-thread" className="v2-msec" aria-labelledby="v2-bm-thread-title">
            <header className="v2-msec__head"><h2 id="v2-bm-thread-title" className="v2-column__title v2-column__title--section">{japanese ? "スレッド" : "Threads"}</h2><span className="v2-msec__note">{counts.thread}</span></header>
            {counts.thread ? (
              <ul className="v2-tlist">
                {data.items.map((item) => item.kind === "thread" ? (
                  <li key={item.id} className="v2-tcard">
                    <Link className="v2-tcard__title" href={toV2(item.href)}>{item.title}</Link>
                    {item.note ? <p className="v2-tcard__excerpt">{item.note}</p> : null}
                  </li>
                ) : null)}
              </ul>
            ) : <p className="v2-note">{japanese ? "保存したスレッドはありません。" : "No saved threads."}</p>}
          </section>
          <section id="v2-bm-reply" className="v2-msec" aria-labelledby="v2-bm-reply-title">
            <header className="v2-msec__head"><h2 id="v2-bm-reply-title" className="v2-column__title v2-column__title--section">{japanese ? "返信" : "Replies"}</h2><span className="v2-msec__note">{counts.reply}</span></header>
            {counts.reply ? (
              <ul className="v2-tlist">
                {data.items.map((item) => item.kind === "reply" ? (
                  <li key={item.id} className="v2-tcard">
                    <Link className="v2-tcard__title" href={toV2(item.href)}>{item.threadTitle}</Link>
                    <p className="v2-tcard__excerpt">{item.body}</p>
                    <p className="v2-tcard__foot"><span className="v2-post__time">{item.displayName}</span></p>
                  </li>
                ) : null)}
              </ul>
            ) : <p className="v2-note">{japanese ? "保存した返信はありません。" : "No saved replies."}</p>}
          </section>
        </>
      )}
    </V2Shell>
  );
}
