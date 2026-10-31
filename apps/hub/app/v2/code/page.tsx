import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CodeIndex } from "@/components/code/code-index";
import { CodeShell } from "@/components/code/code-shell";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { listOwnCodeRepositories, listPublicCodeRepositories, type CodeRepositoryView } from "@/lib/server/code-repositories";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "コード | Hub v2" };

export default async function V2CodePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  if (!isOptionalServiceEnabled("code")) notFound();
  const query = ((await searchParams).q ?? "").slice(0, 100);
  // 語で探すときは公開リポジトリを API の上限（100件）まで読む。ふだんは新しい30件。
  const publicLimit = query.trim() ? 100 : 30;
  return (
    <CodeShell title="コード">
      {async ({ profileId }) => {
        const database = getOptionalHubD1();
        let own: CodeRepositoryView[] = [];
        let publicRepos: CodeRepositoryView[] = [];
        let unavailable = !database;
        if (database) {
          try {
            [own, publicRepos] = await Promise.all([
              profileId ? listOwnCodeRepositories(database, profileId) : Promise.resolve([] as CodeRepositoryView[]),
              listPublicCodeRepositories(database, publicLimit),
            ]);
          } catch {
            unavailable = true;
          }
        }
        return <CodeIndex signedIn={Boolean(profileId)} own={own} publicRepos={publicRepos} query={query} unavailable={unavailable} publicLimit={publicLimit} />;
      }}
    </CodeShell>
  );
}
