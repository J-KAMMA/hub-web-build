import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CodeCreateForm } from "@/components/code/code-create-form";
import { CodeShell } from "@/components/code/code-shell";
import { isOptionalServiceEnabled } from "@/lib/optional-services";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "新しいリポジトリ | Hub v2" };

export default async function V2CodeNewPage() {
  if (!isOptionalServiceEnabled("code")) notFound();
  return (
    <CodeShell title="新しいリポジトリ">
      {({ profileId }) => (
        <>
          <header className="hub-code__head">
            <div>
              <p className="hub-code__crumb"><Link href="/v2/code">コード</Link></p>
            </div>
          </header>
          <section className="hub-code__panel">
            {profileId ? <CodeCreateForm /> : <p className="hub-code__empty">ログインするとリポジトリを作れます。</p>}
          </section>
        </>
      )}
    </CodeShell>
  );
}
