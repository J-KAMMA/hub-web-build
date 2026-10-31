import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CodeRepositoryPage } from "@/components/code/code-repository-page";
import { CodeShell } from "@/components/code/code-shell";
import { getInstanceOrigin } from "@/lib/instance-origin";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { getCodeRepository, type CodeRepositoryView } from "@/lib/server/code-repositories";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "リポジトリ | Hub v2" };

export default async function V2CodeRepositoryPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  if (!isOptionalServiceEnabled("code")) notFound();
  const { owner, name } = await params;
  return (
    <CodeShell title={`${decodeURIComponent(owner)}/${decodeURIComponent(name)}`}>
      {async ({ profileId }) => {
        const database = getOptionalHubD1();
        let repository: CodeRepositoryView | null = null;
        let unavailable = !database;
        if (database) {
          try {
            repository = await getCodeRepository(database, profileId || null, decodeURIComponent(owner), decodeURIComponent(name));
          } catch {
            unavailable = true;
          }
        }
        if (unavailable) return <p className="hub-code__error" role="status">リポジトリを読み込めませんでした。時間をおいて開き直してください。</p>;
        if (!repository) {
          return (
            <section className="hub-code__panel">
              <h2 className="hub-code__h1">リポジトリが見つかりません</h2>
              <p className="hub-code__lead">存在しないか、見る権限がありません。</p>
              <div className="hub-code__actions"><Link className="hub-code__button" href="/v2/code">コードへ戻る</Link></div>
            </section>
          );
        }
        return <CodeRepositoryPage repository={repository} origin={getInstanceOrigin()} />;
      }}
    </CodeShell>
  );
}
