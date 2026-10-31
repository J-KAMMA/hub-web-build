import type { ReactNode } from "react";

/*
 * ここではシェルを組まない。/legal の各画面が自分の道で1枚だけ持つ。
 * 以前はここと ServiceLegalPage の両方が AppShell を出しており、
 * 5画面でシェルが二重になっていた。外側の本体910pxの中に
 * 210+640+320=1170pxのシェルが入り、右列が本体の外（1060〜1380）へ出て、
 * 1画面あたり588件のはみ出しになっていた。
 * 画面ごとに currentPath が違うことにも意味がある。AppShell はそれを見て
 * 右列を出すか、見出しをどれにするか、検索欄をどこへ置くかを決める。
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return children;
}
