"use client";

import { useState } from "react";

import { V2ThreadPost, type V2ThreadPostData } from "@/components/v2/v2-thread-post";

/*
 * スレッドの投稿の並び。投稿順だけ（会話別の表示はまだ無い）。
 * 未読の区切り線は、フォローしていて既読位置があるときだけ出す。
 * 反応の失敗は1か所にまとめて出す。投稿ごとに出すと本文の間に散らばる。
 */
export function V2ThreadBody({
  threadId,
  posts,
  threadAuthorId,
  bestAnswerPostId,
  canPickBestAnswer,
  authenticated,
  lastReadPostNo,
  locale,
}: {
  threadId: string;
  posts: V2ThreadPostData[];
  threadAuthorId: string | null;
  bestAnswerPostId: string | null;
  canPickBestAnswer: boolean;
  authenticated: boolean;
  lastReadPostNo: number;
  locale: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const ja = locale === "ja";

  return (
    <section className="v2-tbody" aria-label={ja ? "投稿" : "Posts"}>
      {error ? <p className="v2-error" role="alert">{error}</p> : null}
      {posts.map((post) => (
        <div key={post.id}>
          {lastReadPostNo > 0 && post.no === lastReadPostNo + 1 ? (
            <p className="v2-unread"><span>{ja ? "ここから未読" : "Unread from here"}</span></p>
          ) : null}
          <V2ThreadPost
            threadId={threadId}
            post={post}
            isThreadAuthor={Boolean(post.authorProfileId && post.authorProfileId === threadAuthorId)}
            isBestAnswer={bestAnswerPostId === post.id}
            canPickBestAnswer={canPickBestAnswer}
            authenticated={authenticated}
            locale={locale}
            onError={setError}
          />
        </div>
      ))}
    </section>
  );
}
