import Link from "next/link";

import { LegalToc } from "@/components/legal-toc";

/*
 * サービス条件の本文。v2 昇格（2026-09-19）で /legal/* は /v2/legal/* へ転送され、
 * この部品は V2Shell の中だけで描かれる。器は持たない。
 */
type LegalSection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

export function ServiceLegalPage({
  summary,
  sections,
}: {
  title: string;
  summary: string;
  sections: LegalSection[];
}) {
  return (
    <section className="hub-legal">
      <header>
        <p className="hub-legal__summary">{summary}</p>
      </header>
      <LegalToc />
      {sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.items?.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </section>
      ))}
      <section>
        <h2>共通文書</h2>
        <p><Link href="/v2/terms">Hub利用規約</Link>と<Link href="/v2/privacy">プライバシーポリシー</Link>も適用されます。</p>
      </section>
    </section>
  );
}
