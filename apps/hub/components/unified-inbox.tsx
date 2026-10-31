"use client";

import { useRouter } from "next/navigation";
import type { DirectMessage, MessageConversation, Profile } from "@/lib/domain";
import { EmailWorkspace } from "@/components/email-workspace";
import { MessagesWorkspace } from "@/components/messages-workspace";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

type InboxChannel = "dm" | "email";

type Props = {
  channel: InboxChannel;
  currentProfileId: string;
  initialConversations: MessageConversation[];
  initialMessages: DirectMessage[];
  profiles: Profile[];
  initialConversationId?: string;
};

export function UnifiedInbox(props: Props) {
  const router = useRouter();
  /* 受信箱の切り替えは今いる面の中で。v2 から押して既存の画面へ出ないように。 */
  const surface = useHubUiSurface();
  /*
   * v2 のメールは別の画面（/v2/messages/email）。v2 のメッセージは DM 専用の器で、
   * そこへメールを混ぜると両方の形が崩れるので、?channel= ではなく道を分けた。
   */
  const dmHref = hubSurfacePath(surface, "/messages");
  const emailHref = surface === "/v2" ? "/v2/messages/email" : "/messages?channel=email";
  return (
    <div className="unified-inbox">
      <header className="unified-inbox__header">
        {/*
          * No heading here. The shell page header already names this screen,
          * and it calls it メッセージ — this said 受信箱, so the same screen
          * carried two names in two h1 elements. The band stays for the tabs.
          */}
        <div className="unified-inbox__tabs" role="tablist" aria-label="受信箱の種類">
          <button type="button" role="tab" aria-selected={props.channel === "dm"} className={props.channel === "dm" ? "is-active" : ""} onClick={() => router.replace(dmHref)}>DM</button>
          <button type="button" role="tab" aria-selected={props.channel === "email"} className={props.channel === "email" ? "is-active" : ""} onClick={() => router.replace(emailHref)}>メール</button>
        </div>
      </header>
      <div className="unified-inbox__content" role="tabpanel">
        {props.channel === "email" ? <EmailWorkspace /> : <MessagesWorkspace currentProfileId={props.currentProfileId} initialConversations={props.initialConversations} initialMessages={props.initialMessages} profiles={props.profiles} initialConversationId={props.initialConversationId} />}
      </div>
    </div>
  );
}
