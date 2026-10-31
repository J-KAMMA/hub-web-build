import Link from "next/link";

import { AppShell } from "@/components/app-shell";

export default function PostNotFound() {
  return (
    <AppShell currentPath="/posts" notificationCount={0} messageCount={0}>
      <section
        className="post-not-found"
        aria-labelledby="post-not-found-title"
      >
        <span aria-hidden="true">404</span>
        <h1 id="post-not-found-title">この投稿は表示できません</h1>
        <p>投稿が削除された、公開範囲が変更された、またはURLが正しくない可能性があります。</p>
        <nav aria-label="次の操作">
          <Link href="/">ホームへ戻る</Link>
          <Link href="/search">別の投稿を検索</Link>
        </nav>
      </section>
    </AppShell>
  );
}
