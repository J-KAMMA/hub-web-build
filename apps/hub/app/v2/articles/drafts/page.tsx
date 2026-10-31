import type { Metadata } from "next";
import Link from "next/link";

import { ArticleDraftsList } from "@/components/article-drafts-list";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../../articles/composer.css";
import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "下書きと自分の記事 | Hub v2" };

/* 自分の下書き（予約中を含む）と、公開した記事の一覧。内容は本人のAPIから読む。 */
export default function V2ArticleDraftsPage() {
  return (
    <V2PanelPage wide currentPath="/v2/articles" title="下書きと自分の記事" note={<Link href="/v2/articles/stats">記事の統計を見る</Link>}>
      <ArticleDraftsList />
    </V2PanelPage>
  );
}
