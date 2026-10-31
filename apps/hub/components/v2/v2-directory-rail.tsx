import Link from "next/link";

import { V2Icon } from "@/components/v2/v2-icons";

/*
 * 内側左列に共通する戻る・作る・検索。開閉しても同じ位置に置き、
 * 畳んだときはラベルだけを隠す。
 *
 * 検索は行き先ではなく「列を開いて検索欄に焦点を置く」。列を開くのは V2Columns の
 * 仕事なので、ここは data-rail-focus を付けた押しボタンを置くだけ。
 */
export function V2DirectoryRail({
  back,
  create,
  search = false,
  japanese = true,
}: {
  back?: { href: string; label?: string };
  create?: { href: string; label: string };
  search?: boolean;
  japanese?: boolean;
}) {
  const backLabel = back?.label ?? (japanese ? "戻る" : "Back");
  const searchLabel = japanese ? "検索" : "Search";
  return (
    <>
      {back ? (
        <Link href={back.href} className="v2-rail__item" title={backLabel}>
          <V2Icon name="chevron-left" />
          <span className="v2-directory__tool-label">{backLabel}</span>
        </Link>
      ) : null}
      {create ? (
        <Link href={create.href} className="v2-rail__item" title={create.label}>
          <V2Icon name="plus" />
          <span className="v2-directory__tool-label">{create.label}</span>
        </Link>
      ) : null}
      {search ? (
        <button type="button" className="v2-rail__item" title={searchLabel} data-rail-focus="search">
          <V2Icon name="search" />
          <span className="v2-directory__tool-label">{searchLabel}</span>
        </button>
      ) : null}
    </>
  );
}
