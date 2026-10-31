"use client";

import { useEffect } from "react";

/* 記事を開いたときに閲覧を1つ数える。表示は何も出さない。同じタブで同じ記事は1回だけ。 */
export function V2ArticleViewBeacon({ articleId }: { articleId: string }) {
  useEffect(() => {
    const key = `hub.articleView.${articleId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch { /* 保存できなくても数える */ }
    void fetch(`/api/articles/${encodeURIComponent(articleId)}/view`, { method: "POST", keepalive: true }).catch(() => undefined);
  }, [articleId]);
  return null;
}
