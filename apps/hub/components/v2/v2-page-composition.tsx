import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { V2ColumnHead, V2PageHeader } from "./v2-columns";

/* ページ枠が明示した見出しだけを見る。本文や利用者の文章は比較・変更しない。 */
export function pageHeadingTitle(children: ReactNode): string | undefined {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ title?: ReactNode; heading?: boolean; children?: ReactNode }>(child)) continue;
    if ((child.type === V2ColumnHead && child.props.heading || child.type === V2PageHeader)
      && typeof child.props.title === "string") return child.props.title;
    if (child.type === Fragment) {
      const title = pageHeadingTitle(child.props.children);
      if (title) return title;
    }
  }
}

export function distinctDirectoryTitle(directoryTitle: ReactNode, pageTitle: string | undefined): ReactNode {
  return typeof directoryTitle === "string" && pageTitle !== undefined && directoryTitle.trim() === pageTitle.trim()
    ? null : directoryTitle;
}
