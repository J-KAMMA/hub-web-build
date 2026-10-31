import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2Contacts } from "@/components/v2/v2-contacts";
import { Avatar } from "@/components/v2/ui/avatar";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Messages } from "@/components/v2/v2-messages";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { getMessagesPageData } from "@/lib/server/messages-page-data";
import { conversationPartner, lastMessageLine, sortConversations, unreadFor } from "@/lib/v2-messages";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { v2NavItems } from "@/lib/v2-nav";
import { relativeTime } from "@/lib/v2-time";

import "../v2.css";
import "../redesign-sns.css";
import "../v2-luxe.css";
import "../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "メッセージ | Hub v2",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 のメッセージ。既存の /messages には触れない。データは既存の
 * getMessagesPageData をそのまま使う（会話・当該会話のメッセージ・相手と候補）。
 * 会話の一覧は内側左列。選ぶと URL が変わってサーバーが取り直す。
 * メールは別の画面（/v2/messages/email）。DM 専用の器に混ぜない。
 */
export default async function V2MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requested = one(params.conversation).trim();
  const [shell, data] = await Promise.all([getAppShellData(), getMessagesPageData(requested || undefined)]);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const profileMap = new Map((data?.profiles ?? []).map((profile) => [profile.id, profile]));
  const conversations = data ? sortConversations(data.conversations) : [];
  const active = data ? conversations.find((item) => item.id === data.activeConversationId) ?? null : null;

  /* 会話一覧は本文列の左ペイン（2ペインのメッセンジャー）。連絡先は一覧の下。 */
  const listPane = (
    <aside className="v2-messenger__list" aria-label={japanese ? "会話" : "Conversations"}>
      {conversations.length ? (
        <ul className="v2-convs">
          {conversations.map((conversation) => {
            const partner = data ? conversationPartner(conversation, data.currentProfileId, profileMap) : undefined;
            const unread = data ? unreadFor(conversation, data.currentProfileId) : 0;
            const lastLine = data ? lastMessageLine(data.messages, conversation.id, data.currentProfileId, japanese) : null;
            return (
              <li key={conversation.id}>
                <Link className="v2-conv" data-unread={unread > 0 ? "true" : undefined} href={`/v2/messages?conversation=${encodeURIComponent(conversation.id)}`} aria-current={active?.id === conversation.id ? "page" : undefined}>
                  <Avatar name={partner?.displayName} src={partner?.avatarUrl} size={48} />
                  <span className="v2-conv__body">
                    <span className="v2-conv__name">
                      {partner?.displayName ?? (japanese ? "相手" : "Partner")}
                      {partner ? <span className="v2-conv__handle"> @{partner.handle}</span> : null}
                    </span>
                    <span className="v2-conv__sub">{lastLine ?? (partner ? `@${partner.handle}` : "")}</span>
                  </span>
                  <span className="v2-conv__meta">
                    <span className="v2-conv__time">{relativeTime(conversation.lastMessageAt, locale)}</span>
                    {unread > 0 ? <span className="v2-conv__dot" role="img" aria-label={japanese ? `未読 ${unread}件` : `${unread} unread`} /> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data ? (
        <section className="v2-messenger__contacts" aria-label={japanese ? "連絡先" : "Contacts"}>
          <h2 className="v2-messenger__heading">{japanese ? "連絡先" : "Contacts"}</h2>
          <V2Contacts currentProfileId={data.currentProfileId} profiles={data.profiles} japanese={japanese} />
        </section>
      ) : null}
    </aside>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/messages"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "メッセージ" : "Messages"}
        action={<>
          {data && data.messageCount > 0 ? <span className="v2-heading__note">{japanese ? `未読 ${data.messageCount}` : `${data.messageCount} unread`}</span> : null}
          {isOptionalServiceEnabled("mail") ? <Link className="v2-heading__note" href="/v2/messages/email">{japanese ? "メール" : "Email"}</Link> : null}
        </>}
      />

      {!data ? (
        <V2State
          kind="signedOut"
          icon="mail"
          next="/v2/messages"
          japanese={japanese}
          note={japanese ? "ログインするとメッセージが見られます。" : "Sign in to see messages."}
        />
      ) : (
        <div className="v2-messenger" data-active={active && requested ? "true" : "false"} data-empty={conversations.length === 0 ? "true" : undefined}>
          {listPane}
          <div className="v2-messenger__thread">
        <V2Messages
          key={active?.id ?? "none"}
          currentProfileId={data.currentProfileId}
          conversation={active}
          initialConversations={conversations}
          initialMessageCount={data.messageCount}
          initialMessages={active ? data.messages.filter((message) => message.conversationId === active.id) : []}
          profiles={data.profiles}
          locale={locale}
        />
          </div>
        </div>
      )}
    </V2Shell>
  );
}
