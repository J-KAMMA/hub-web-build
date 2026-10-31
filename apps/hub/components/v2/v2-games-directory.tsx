import Link from "next/link";

/*
 * ゲームの内側左列の頭（2026-10-18）。ストアとライブラリを分けて置く（Steam の「ストア」「ライブラリ」）。
 * 機種の絞り込みなど、画面ごとの節はこの下に続ける。
 */
export function V2GamesSections({ current, japanese }: { current: "store" | "library" | "sell"; japanese: boolean }) {
  return (
    <ul className="v2-nav__list">
      <li><Link className="v2-nav__item" href="/v2/games" aria-current={current === "store" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "ストア" : "Store"}</span></Link></li>
      <li><Link className="v2-nav__item" href="/v2/games/library" aria-current={current === "library" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "ライブラリ" : "Library"}</span></Link></li>
      <li><Link className="v2-nav__item" href="/v2/games/sell" aria-current={current === "sell" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "出品" : "Sell"}</span></Link></li>
    </ul>
  );
}
