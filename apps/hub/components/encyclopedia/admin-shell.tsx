import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./admin.module.css";

export function EncyclopediaAdminShell({ children }: { children: ReactNode }) {
  return <div className={styles.shell}><div className={styles.wrap}><nav className={styles.nav}><Link className={styles.brand} href="/admin/encyclopedia">AI百科事典 管理</Link><div className={styles.navlinks}><Link className={styles.link} href="/admin/encyclopedia">項目一覧</Link><Link className={styles.link} href="/admin/encyclopedia/operations">品質・運用</Link><Link className={`${styles.button} ${styles.buttonPrimary}`} href="/admin/encyclopedia/new">新規作成</Link></div></nav>{children}</div></div>;
}
