import type { Metadata } from "next";

import { ArticleComposer } from "@/components/article-composer";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../../articles/composer.css";
import "../../v2.css";
import "../../v2-article.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "記事を書く | Hub v2" };

const ID = /^[A-Za-z0-9_-]{1,80}$/;

function pick(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && ID.test(first) ? first : null;
}

/*
 * 記事を書く（2026-10-14 作り直し）。?draft=ID でサーバーの下書きを、
 * ?article=ID で公開中の自分の記事を開く。どちらも無ければ新しい下書き。
 * 他人のIDは API が404にするので、画面は「開けませんでした」を出すだけ。
 * ?gate=1 は「鍵つきの記事を書く」からの入口で、公開設定（鍵の欄）を開いた状態で始める。
 */
export default async function V2ArticleComposerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const articleId = pick(params.article);
  const gateId = pick(params.gate);
  const draftId = articleId ? null : pick(params.draft);
  return (
    <V2PanelPage wide currentPath="/v2/articles" title="記事を書く">
      <ArticleComposer key={`${articleId ?? ""}:${draftId ?? ""}`} articleId={articleId} draftId={draftId} openSettings={params.gate === "1" || gateId !== null} presetGateId={gateId} />
    </V2PanelPage>
  );
}
