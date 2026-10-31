import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UnifiedInbox } from "@/components/unified-inbox";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getMessagesPageData } from "@/lib/server/messages-page-data";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "メール | Hub v2" };

/*
 * メールの受信箱（2026-09-04、旦那様の「古いUIを出さない」）。
 *
 * v2 のメッセージは DM の形で作り直してあり、メールは既存の
 * /messages?channel=email へ渡していた。押すと古いUIへ出る。
 * 受信箱は既存の UnifiedInbox をそのまま置く。中身は作り直さない。
 *
 * 道が /v2/messages?channel=email ではなく別の画面なのは、v2 の
 * メッセージが DM 専用の器（会話の一覧が内側左列）で、そこへメールを
 * 混ぜると両方の形が崩れるから。
 */
export default async function V2MessagesEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedConversation = Array.isArray(params.conversation) ? params.conversation[0] : params.conversation;
  const data = await getMessagesPageData(requestedConversation);
  if (!data) redirect("/auth?next=/v2/messages/email");
  return (
    <V2PanelPage wide currentPath="/v2/messages" title="メール">
      <UnifiedInbox
        channel="email"
        currentProfileId={data.currentProfileId}
        initialConversations={data.conversations}
        initialMessages={data.messages}
        profiles={data.profiles}
        initialConversationId={data.activeConversationId}
      />
    </V2PanelPage>
  );
}
