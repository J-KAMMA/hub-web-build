import { Children, cloneElement, isValidElement, type ReactNode } from "react";

type ContentProps = { children?: ReactNode; className?: string; title?: string };

function labelText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<ContentProps>(node)) return labelText(node.props.children);
  return Children.toArray(node).map(child => isValidElement<ContentProps>(child) ? labelText(child.props.children) : String(child ?? "")).join("");
}

/*
 * 内側左列は 2026-10-11 に廃止し、目録は見出しの下の横並びのタブになった。
 * ここはタブにするリンクへ title（=ラベル）を足すだけで、別のリンク一覧に置き換えない。
 * 以前の「畳んだ列用の頭字」は不要になったので足さない。
 */
export function directoryContent(node: ReactNode): ReactNode {
  return Children.map(node, child => {
    if (!isValidElement<ContentProps>(child)) return child;
    if (child.props.className?.split(" ").includes("v2-nav__item")) {
      const label = Children.toArray(child.props.children).find(item => isValidElement<ContentProps>(item) && item.props.className?.split(" ").includes("v2-nav__label"));
      if (label) return cloneElement(child, { title: child.props.title ?? labelText(label) });
    }
    return child.props.children ? cloneElement(child, {}, directoryContent(child.props.children)) : child;
  });
}
