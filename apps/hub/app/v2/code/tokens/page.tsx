import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CodeShell } from "@/components/code/code-shell";
import { CodeTokenManager } from "@/components/code/code-token-manager";
import { isOptionalServiceEnabled } from "@/lib/optional-services";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "開発者トークン | Hub v2" };

export default async function V2CodeTokensPage() {
  if (!isOptionalServiceEnabled("code")) notFound();
  return (
    <CodeShell title="開発者トークン">
      {({ profileId }) => (
        <>
          <header className="hub-code__head">
            <div>
              <p className="hub-code__crumb"><Link href="/v2/code">コード</Link></p>
              <p className="hub-code__lead">git のパスワード欄に入れる鍵です。Hub には鍵そのものを残さず、照合用の値だけを持ちます。</p>
            </div>
          </header>
          {profileId ? <CodeTokenManager /> : <section className="hub-code__panel"><p className="hub-code__empty">ログインするとトークンを管理できます。</p></section>}
        </>
      )}
    </CodeShell>
  );
}
