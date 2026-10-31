import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "スレッド管理 | Hub",
  robots: { index: false, follow: false }
};

export default function ModerationLayout({ children }: { children: ReactNode }) {
  return children;
}
