import "server-only";

import {
  getConversationById,
  getConversations,
  getMessagesForConversation,
  getProfiles,
  markConversationRead,
  sendMessage,
  startDirectMessage,
  updateConversationVerification
} from "@/lib/mock-data";

type StartDirectMessageResult = ReturnType<typeof startDirectMessage>;
type SendMessageInput = Parameters<typeof sendMessage>[0];
type Message = ReturnType<typeof sendMessage>;
type Conversation = NonNullable<ReturnType<typeof getConversationById>>;
type VerificationStatus = Parameters<typeof updateConversationVerification>[1];

export interface StartDirectMessageRouteData {
  conversation_id: string;
  created_new: boolean;
  verification_status: StartDirectMessageResult["conversation"]["verificationStatus"];
  fingerprint: StartDirectMessageResult["conversation"]["fingerprint"];
}

export function startDirectMessageRouteData(targetProfileId: string): StartDirectMessageRouteData {
  const result = startDirectMessage(targetProfileId);

  return {
    conversation_id: result.conversation.id,
    created_new: result.createdNew,
    verification_status: result.conversation.verificationStatus,
    fingerprint: result.conversation.fingerprint
  };
}

export function getMessageConversationsRouteData() {
  const profiles = getProfiles();
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const conversations = getConversations().map((conversation) => {
    const partner = conversation.participantIds
      .map((id) => profileMap.get(id))
      .find((profile) => profile && !profile.isCurrentUser);
    const latestMessage = getMessagesForConversation(conversation.id).at(-1);

    return {
      conversation_id: conversation.id,
      participants: conversation.participantIds
        .map((id) => profileMap.get(id))
        .filter(Boolean),
      last_message_preview: latestMessage?.previewText ?? null,
      unread_count: conversation.unreadCountByProfileId["profile-me"] ?? 0,
      e2ee: conversation.isE2ee,
      verification_status: conversation.verificationStatus,
      fingerprint: conversation.fingerprint,
      partner
    };
  });

  return { conversations };
}

export function getMessageConversationRouteData(conversationId: string) {
  const conversation = getConversationById(conversationId);

  if (!conversation) {
    return undefined;
  }

  const profiles = getProfiles();

  return {
    conversation,
    participants: conversation.participantIds
      .map((participantId) => profiles.find((profile) => profile.id === participantId))
      .filter(Boolean),
    messages: getMessagesForConversation(conversationId)
  };
}

export interface SendMessageRouteData {
  message: Message;
}

export function sendMessageRouteData(input: SendMessageInput): SendMessageRouteData {
  return {
    message: sendMessage(input)
  };
}

export interface MarkConversationReadRouteData {
  conversation: Conversation | undefined;
  conversation_id?: string;
  unread_count?: number;
}

export function markConversationReadRouteData(conversationId: string): MarkConversationReadRouteData {
  const conversation = markConversationRead(conversationId);

  if (!conversation) {
    return { conversation };
  }

  return {
    conversation,
    conversation_id: conversation.id,
    unread_count: conversation.unreadCountByProfileId["profile-me"] ?? 0
  };
}

export interface UpdateConversationVerificationRouteData {
  conversation: Conversation | undefined;
  conversation_id?: string;
  verification_status?: Conversation["verificationStatus"];
  fingerprint?: Conversation["fingerprint"];
}

export function updateConversationVerificationRouteData(
  conversationId: string,
  status: VerificationStatus,
  fingerprint?: string
): UpdateConversationVerificationRouteData {
  const conversation = updateConversationVerification(conversationId, status, fingerprint);

  if (!conversation) {
    return { conversation };
  }

  return {
    conversation,
    conversation_id: conversation.id,
    verification_status: conversation.verificationStatus,
    fingerprint: conversation.fingerprint
  };
}
