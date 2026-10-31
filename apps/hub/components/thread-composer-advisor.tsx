"use client";

import { useMemo } from "react";

export function ThreadComposerAdvisor({ title, body }: { title: string; body: string }) {
  const checks = useMemo(() => {
    const combined = `${title}\n${body}`;
    return [
      { ok: title.trim().length >= 12, label: "タイトルから内容が具体的に分かる" },
      { ok: /背景|目的|困|知りたい|共有/.test(body), label: "背景または目的が書かれている" },
      { ok: /https?:\/\/|出典|公式|資料/.test(body), label: "根拠や出典を確認できる" },
      { ok: /地域|国|言語|環境|条件/.test(body), label: "対象地域や条件が分かる" },
    ];
  }, [body, title]);
  const score = checks.filter((check) => check.ok).length;
  const missing = checks.filter((check) => !check.ok);
  if (!title.trim() && !body.trim()) return null;
  if (!missing.length) return <p className="thread-composer-advisor thread-composer-advisor--ready">✓ 投稿に必要な情報がそろっています。</p>;
  return <aside className="thread-composer-advisor" aria-live="polite">
    <header><strong>補足すると伝わりやすくなります</strong><span>{score} / {checks.length}</span></header>
    <ul>{missing.map((check) => <li key={check.label}>○ {check.label}</li>)}</ul>
    <small>未達成でも投稿できます。個人情報や秘密情報は書かないでください。</small>
  </aside>;
}
