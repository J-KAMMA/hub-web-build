import { cookies } from "next/headers";

import { ThreadCategoryOperations } from "@/components/thread-category-operations";
import { AdminAccessRequired } from "@/components/admin-access-required";
import { getHubD1 } from "@/lib/server/hub-d1";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export default async function ThreadCategoryOperationsPage() {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) return <AdminAccessRequired />;
  const db = getHubD1();
  const [rows, mock, safety] = await Promise.all([
    db.prepare(`SELECT b.board_key,b.title,COUNT(t.id) threads,
      SUM(CASE WHEN t.updated_at>=datetime('now','-7 days') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN t.id LIKE 'category-mock-%' THEN 1 ELSE 0 END) mocks
      FROM boards b LEFT JOIN threads t ON t.board_id=b.id
      GROUP BY b.id ORDER BY threads DESC,b.title`).all<{board_key:string;title:string;threads:number;active:number;mocks:number}>(),
    db.prepare("SELECT COUNT(*) total FROM threads WHERE id LIKE 'category-mock-%'").first<{total:number}>(),
    db.prepare("SELECT setting_value FROM thread_safety_settings WHERE setting_key='auto_hide_report_threshold'").first<{setting_value:number}>().catch(() => null),
  ]);
  return <section className="thread-category-admin">
    <header><a href="/admin/moderation">← モデレーション</a><h1>スレッドカテゴリ運用</h1><p>利用量に基づき、統合・分割・名称見直しの候補を確認できます。</p></header>
    <ThreadCategoryOperations mockCount={Number(mock?.total ?? 0)} reportThreshold={Number(safety?.setting_value ?? 3)} />
    <section><h2>自動提案</h2><table><thead><tr><th>カテゴリ</th><th>全件</th><th>7日以内</th><th>モック</th><th>提案</th></tr></thead><tbody>
      {(rows.results ?? []).map((row) => {
        const recommendation = Number(row.threads) <= 2 ? "近いカテゴリとの統合を検討" : Number(row.active) >= 50 ? "話題ごとの分割を検討" : Number(row.mocks) === Number(row.threads) ? "実投稿が入るまでモック表示" : "維持";
        return <tr key={row.board_key}><td><a href={`/bbs?board=${row.board_key}`}>{row.title}</a></td><td>{row.threads}</td><td>{row.active}</td><td>{row.mocks}</td><td>{recommendation}</td></tr>;
      })}
    </tbody></table></section>
  </section>;
}
