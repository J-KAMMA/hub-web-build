import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2ContentFiles } from "@/components/v2/v2-content-files";
import { V2ContentLicense } from "@/components/v2/v2-content-license";
import { V2DownloadButton } from "@/components/v2/v2-content-download";
import { readDownloadPolicy } from "@/lib/server/content-downloads";
import { V2HubpediaCitations } from "@/components/v2/v2-hubpedia-citations";
import { V2Post } from "@/components/v2/v2-post";
import { V2ReplyComposer } from "@/components/v2/v2-reply-composer";
import { V2ReplyList } from "@/components/v2/v2-reply-list";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { normalizePostReplyOrder, type PostReplyOrder } from "@/lib/post-reply-order";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { loadHubItemCitations } from "@/lib/server/hubpedia-citations";
import { getActiveAccountMove } from "@/lib/server/account-bundle";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getContentLicense } from "@/lib/server/content-licenses";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";
import { getPostPageData } from "@/lib/server/post-page-data";
import { socialStreamReturnHref } from "@/lib/social-stream-return";

import "../../v2.css";
import "../../v2-luxe.css";
import "../../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "投稿 | Hub v2",
};

const ORDERS: { value: PostReplyOrder; ja: string; en: string }[] = [
  { value: "recommended", ja: "おすすめ", en: "Recommended" },
  { value: "latest", ja: "新しい順", en: "Latest" },
  { value: "oldest", ja: "古い順", en: "Oldest" },
];

/*
 * v2 の投稿詳細。データは既存の getPostPageData をそのまま使う
 * （祖先の連なり・元投稿・返信の並び）。既存の /posts/[id] には触れない。
 *
 * 落とさなかったもの: 会話の流れ、返信元があるときの「選択した返信」、
 * 未ログインの誘導（戻り先つき）、並び3種（?replies=）、初回20件と続きの取得、
 * 返信数のリアルタイム反映、下書きと二重送信の防止。
 */
export default async function V2PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ replies?: string | string[]; returnTo?: string | string[] }>;
}) {
  const { postId } = await params;
  const query = await searchParams;
  const order = normalizePostReplyOrder(query.replies);
  const streamReturn = socialStreamReturnHref(query.returnTo), backHref = streamReturn ?? "/v2";
  const returnQuery = streamReturn ? `&returnTo=${encodeURIComponent(streamReturn)}` : "";
  const locale = await getHubLocale();
  const japanese = locale === "ja";

  const [{ currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount }, page] = await Promise.all([
    getAppShellData(),
    getPostPageData(postId, order, { skipCounts: true }),
  ]);
  if (!page.post) notFound();
  const post = page.post;
  /* The citation lookup needs only the post id, so it runs alongside the account-move check. */
  const citationsPromise = loadHubItemCitations("post", post.id);
  citationsPromise.catch(() => undefined);
  /* 移転した人の投稿ページは、移転後12か月、新しい家のプロフィールへ永続的に送る（本人は元のまま見える）。 */
  const movedDatabase = getOptionalHubD1();
  if (movedDatabase && post.authorProfileId && post.authorProfileId !== currentProfile.id) {
    const move = await getActiveAccountMove(movedDatabase, post.authorProfileId).catch(() => null);
    if (move?.newProfileUrl) permanentRedirect(move.newProfileUrl);
  }
  const citations = await citationsPromise;
  /* 画像つきの投稿にだけライセンスを出す。行が無い・表が無い環境は全権利留保。 */
  const license = movedDatabase && post.images?.length
    ? await getContentLicense(movedDatabase, { targetType: "post", targetId: post.id }).catch(() => "arr" as const)
    : "arr" as const;
  /* ダウンロードの許可（2026-10-17）。表示は案内で、押すたびにサーバーが確かめ直す。 */
  const isAuthor = Boolean(currentProfile.id) && post.authorProfileId === currentProfile.id;
  const downloadPolicy = movedDatabase && post.images?.length
    ? (await readDownloadPolicy(movedDatabase, { targetType: "post", targetId: post.id }).catch(() => null))?.policy ?? "none"
    : "none";
  const imagesDownloadable = isAuthor || downloadPolicy !== "none";

  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  const returnPath = `/v2/posts/${encodeURIComponent(postId)}?replies=${order}${returnQuery}`;

  /*
   * 内側左列には返信の並びを置く。飾りではなく、押すと ?replies= が変わって
   * サーバーが並べ直す（既存と同じ sortPostReplies）。
   */
  const directory = (
    <ul className="v2-nav__list">
      {ORDERS.map((item) => (
        <li key={item.value}>
          <Link
            className="v2-nav__item"
            href={`/v2/posts/${encodeURIComponent(postId)}?replies=${item.value}${returnQuery}`}
            aria-current={item.value === order ? "page" : undefined}
          >
            <span className="v2-nav__label">{japanese ? item.ja : item.en}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: backHref, label: japanese ? "フィードへ戻る" : "Back to feed" }} japanese={japanese} />}
      currentPath={`/v2/posts/${postId}`}
      profile={currentProfile}
      items={items}
      directoryTitle={japanese ? "返信の並び" : "Reply order"}
      directory={directory}
      aside={
        <V2Aside
          posts={socialPosts}
          japanese={japanese}
          signedIn={Boolean(currentProfile.id)}
          viewerId={currentProfile.id}
          title={japanese ? "並べて見る" : "Alongside"}
        />
      }
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "投稿" : "Post"}
        action={
          <Link className="v2-heading__note v2-main-controls--directory-fallback" href={backHref}>
            {japanese ? "← フィードへ戻る" : "← Back to feed"}
          </Link>
        }
      />

      <div className="v2-post-thread">
      {page.ancestors.length ? (
        <section className="v2-thread-context" aria-label={japanese ? "会話の流れ" : "Conversation"}>
          <p className="v2-column__title">{japanese ? "会話の流れ" : "Conversation"}</p>
          <div className="v2-feed">
            {page.ancestors.map((ancestor) => (
              <V2Post key={ancestor.id} post={ancestor} viewerId={currentProfile.id} locale={locale} returnTo={streamReturn ?? undefined} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label={page.ancestors.length ? (japanese ? "選択した返信" : "Selected reply") : (japanese ? "投稿" : "Post")}>
        <div className="v2-feed">
          <V2Post post={post} viewerId={currentProfile.id} locale={locale} returnTo={streamReturn ?? undefined} emphasized />
        </div>
      </section>

      <V2ContentFiles targetType="post" targetId={post.id} canManage={Boolean(currentProfile.id) && post.authorProfileId === currentProfile.id} japanese={japanese} />

      {post.images?.length ? <V2ContentLicense license={license} authorName={post.displayName} japanese={japanese} /> : null}

      {post.images?.length ? (
        <section className="v2-download" aria-label={japanese ? "画像のダウンロード" : "Image downloads"}>
          {imagesDownloadable
            ? post.images.map((image, index) => (
                <V2DownloadButton
                  key={image.id}
                  kind="image"
                  id={image.id}
                  allowed
                  japanese={japanese}
                  label={post.images!.length > 1
                    ? (japanese ? `画像${index + 1}をダウンロード` : `Download image ${index + 1}`)
                    : undefined}
                />
              ))
            : <V2DownloadButton kind="image" id={post.images[0]!.id} allowed={false} japanese={japanese} />}
        </section>
      ) : null}

      <V2HubpediaCitations citations={citations} japanese={japanese} />

      {page.authenticated ? (
        <V2ReplyComposer
          postId={post.id}
          viewerId={page.currentProfileId}
          viewerName={page.currentProfileDisplayName}
          viewerAvatarUrl={page.currentProfileAvatarUrl}
          japanese={japanese}
        />
      ) : (
        <section className="v2-card v2-reply-auth" aria-labelledby="v2-reply-auth-title">
          <p className="v2-card__name" id="v2-reply-auth-title">
            {japanese ? "返信するにはログインが必要です" : "Sign in to reply"}
          </p>
          <p className="v2-card__meta">
            {japanese ? "メールアドレスや電話番号は不要です。端末のパスキーで参加できます。" : "No email or phone needed. Join with a passkey on this device."}
          </p>
          <Link className="v2-card__link" href={`/v2/auth?next=${encodeURIComponent(returnPath)}`}>
            {japanese ? "ログイン・新規登録" : "Sign in or sign up"}
          </Link>
        </section>
      )}

      <V2ReplyList
        postId={post.id}
        order={order}
        initialReplies={page.replies.slice(0, 20)}
        initialHasMore={page.replies.length > 20}
        initialCount={page.replies.length}
        viewerId={currentProfile.id}
        locale={locale}
        returnTo={streamReturn ?? undefined}
      />
      </div>
    </V2Shell>
  );
}
