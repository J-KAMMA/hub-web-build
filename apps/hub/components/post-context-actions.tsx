"use client";

import React from "react";
import { AiContextButton } from "@/components/ai-context-button";
import type { HubAiContext } from "@/lib/ai-context";

type PostContextTarget = "social_post" | "thread_post" | "community_message";

type PostContextActionsProps = {
  body: string;
  targetId: string;
  targetType: PostContextTarget;
  href?: string;
  locale?: "ja" | "en" | string;
};

const AI_SOURCE: Record<PostContextTarget, HubAiContext["source"]> = {
  social_post: "feed",
  thread_post: "thread",
  community_message: "community",
};

/*
 * One tool, not two. The Hubpedia button opened the rail with the post as a
 * query and called whatever came back 「関連する記事」, without checking that
 * anything did. Measured on staging: a post reading 「ポスト」 was answered
 * with ウェブブラウザー, 遺伝学 and 天の川銀河 — the encyclopedia holds ten
 * published articles, so almost any post gets the same three.
 *
 * The AI already lists hubpedia among the surfaces it can read, and unlike a
 * fixed search it can say there is nothing. The rail itself is unchanged and
 * still opens from the right-hand column.
 */
export function PostContextActions({
  body,
  targetId,
  targetType,
  href,
  locale = "ja",
}: PostContextActionsProps) {
  const english = locale === "en";

  return (
    <div
      className="tweet__context-tools tweet__context-tools--upper"
      onClick={(event) => event.stopPropagation()}
    >
      <AiContextButton
        className="tweet__context-tool tweet__context-tool--prominent tweet__context-tool--ai"
        label="AI"
        accessibleLabel={english ? "Open with AI" : "AIで開く"}
        stayOnPage
        controls="hub-right-rail"
        context={{
          source: AI_SOURCE[targetType],
          targetId,
          content: body,
          href,
          intent: targetType === "social_post" ? "explain" : "draft_reply",
        }}
      />
    </div>
  );
}
