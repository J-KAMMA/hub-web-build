export type NotificationType =
  | "social_reply"
  | "social_repost"
  | "social_reaction"
  | "social_bookmark"
  | "thread_reply"
  | "message_received"
  | "followed"
  | "system";

export type NotificationContext = "mention";

export type EngagementTargetType =
  "social_post" | "thread_post" | "community_message" | "vault_content";
export type ReactionKind = "like";

export type NotificationTargetType =
  | "social_post"
  | "vault_content"
  | "profile"
  | "thread"
  | "thread_post"
  | "community_message"
  | "message_conversation"
  | "system";

export type VerificationStatus = "verified" | "unverified";
export type EncryptionState = "sealed" | "draft";

export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  joinedAt: string;
  isCurrentUser?: boolean;
  avatarUrl?: string;
}

export interface FollowRelation {
  followerProfileId: string;
  followedProfileId: string;
}

export interface Board {
  id: string;
  key: string;
  title: string;
  slug: string;
  description: string;
  threadCount: number;
}

export type CommunityRole = "owner" | "moderator" | "member";

export interface CommunityGovernanceTokenRule {
  tokenId: string;
  tokenSymbol?: string;
  tokensPerVote: number;
  weight: number;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  imageUrl?: string;
  description: string;
  category: string;
  knowledgeLabel?: string;
  knowledgeDescription?: string;
  ownerProfileId: string;
  governanceMode?: "standard" | "dao";
  governanceVotingStrategy?:
    "one_member_one_vote" | "token_weighted" | "token_capped";
  governanceTokenId?: string | null;
  governanceTokensPerVote?: number;
  governanceTokenRules?: CommunityGovernanceTokenRule[];
  governanceVoteCap?: number | null;
  createdAt: string;
}

export type CommunityGovernanceProposalKind =
  "guide" | "channel" | "rule" | "moderator";

export type CommunityGovernanceProposalStatus =
  "discussion" | "voting" | "passed" | "rejected" | "executed" | "cancelled";

export type CommunityGovernanceVotingMethod =
  | "one_member_one_vote"
  | "one_holder_one_vote"
  | "token_linear"
  | "token_sqrt"
  | "token_log"
  | "dual_chamber";

export type CommunityGovernanceDecisionScope =
  | "community" | "budget" | "token" | "project" | "rules"
  | "moderation" | "hub_policy" | "security";

export type CommunityGovernanceExecutionMode =
  "advisory" | "operator" | "timelock" | "veto";

export interface CommunityGovernanceProposal {
  id: string;
  communityId: string;
  authorProfileId: string;
  kind: CommunityGovernanceProposalKind;
  title: string;
  body: string;
  status: CommunityGovernanceProposalStatus;
  votingStrategy: "one_member_one_vote" | "token_weighted" | "token_capped";
  votingMethod?: CommunityGovernanceVotingMethod;
  decisionScope?: CommunityGovernanceDecisionScope;
  executionMode?: CommunityGovernanceExecutionMode;
  snapshotPolicy?: "proposal_start" | "seven_day_prior" | "time_weighted";
  snapshotBlockNumber?: string | null;
  snapshotCapturedAt?: string | null;
  quorumMemberBps?: number;
  quorumTokenBps?: number;
  approvalBps?: number;
  governanceTokenId?: string | null;
  governanceTokenSymbol?: string | null;
  tokensPerVote: number;
  governanceTokenRules?: CommunityGovernanceTokenRule[];
  voteWeightCap?: number | null;
  quorum: number;
  approvalThreshold: number;
  linkedGuideProposalId?: string | null;
  votingStartsAt: string;
  votingEndsAt: string;
  createdAt: string;
  updatedAt: string;
  executedAt?: string | null;
}

export interface CommunityGovernanceVote {
  proposalId: string;
  profileId: string;
  choice: "for" | "against" | "abstain";
  weight: number;
  memberWeight?: number;
  tokenWeight?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityGuidePage {
  id: string;
  communityId: string;
  directoryId?: string | null;
  slug: string;
  title: string;
  body: string;
  version: number;
  updatedByProfileId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityGuideDirectory {
  id: string;
  communityId: string;
  parentDirectoryId?: string | null;
  slug: string;
  name: string;
  position: number;
  createdAt: string;
}

export type CommunityGuideProposalStatus =
  "open" | "changes_requested" | "merged" | "closed";

export interface CommunityGuideProposal {
  id: string;
  communityId: string;
  pageId: string | null;
  proposedDirectoryId?: string | null;
  authorProfileId: string;
  title: string;
  proposedTitle: string;
  proposedBody: string;
  summary: string;
  status: CommunityGuideProposalStatus;
  baseVersion: number;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  mergedByProfileId?: string | null;
}

export interface CommunityGuideReview {
  id: string;
  proposalId: string;
  authorProfileId: string;
  body: string;
  decision: "comment" | "approve" | "request_changes";
  createdAt: string;
}

export interface CommunityMembership {
  communityId: string;
  profileId: string;
  role: CommunityRole;
  joinedAt: string;
  status?: "active" | "muted" | "banned";
}

export interface CommunityChannel {
  id: string;
  communityId: string;
  name: string;
  description: string;
  position: number;
  createdAt: string;
}

export interface CommunityChannelMessage {
  id: string;
  channelId: string;
  authorProfileId: string;
  botId?: string | null;
  botName?: string | null;
  body: string;
  createdAt: string;
  replyToMessageId?: string | null;
  editedAt?: string | null;
  kind?: "chat" | "guide" | "question" | "party";
  pinnedAt?: string | null;
  pinnedByProfileId?: string | null;
  workflowStatus?: "open" | "resolved" | "closed";
  images?: Array<{ id: string; url: string; width: number; height: number; altText: string }>;
}

export interface CommunityMessageReport {
  id: string;
  communityId: string;
  channelId: string;
  messageId: string;
  reporterProfileId: string;
  reason: "spam" | "harassment" | "other";
  status: "open" | "resolved";
  createdAt: string;
}

export interface CommunityTokenDefinition {
  id: string;
  communityId: string;
  name: string;
  symbol: string;
  network: string;
  contractAddress?: string;
  createdByProfileId: string;
  createdAt: string;
}

export interface CommunityChannelReaction {
  messageId: string;
  profileId: string;
  emoji: "👍" | "❤️" | "🎉";
  createdAt: string;
}

export interface CommunityChannelReadState {
  channelId: string;
  profileId: string;
  lastReadMessageId: string | null;
  updatedAt: string;
}

export interface ThreadSummary {
  id: string;
  boardKey: string;
  title: string;
  postCount: number;
  updatedAt: string;
  pinned?: boolean;
  bestAnswerPostId?: string;
  solvedAt?: string;
  language?: import("@/lib/thread-scope").ThreadLanguage;
  allowedLanguages?: import("@/lib/thread-scope").ThreadLanguage[];
  allowedLanguageTags?: import("@/lib/thread-fine-scope").ThreadLanguageTag[];
  allowedCountryCodes?: string[];
  writeIpPolicy?: import("@/lib/server/thread-ip-policy").ThreadIpPolicy;
  region?: import("@/lib/thread-scope").ThreadRegion;
  threadType?: import("@/lib/thread-type").ThreadType;
  deadline?: string;
  tags?: string[];
  slowModeSeconds?: number;
  status?: "open" | "closed" | "archived";
  moderationStatus?: "active" | "frozen";
  mergedIntoThreadId?: string;
}

export interface ThreadTracking {
  threadId: string;
  profileId: string;
  following: boolean;
  lastReadPostNo: number;
  updatedAt: string;
  notificationMode?: "instant" | "digest" | "important" | "none";
}

export interface ThreadPost {
  id: string;
  threadId: string;
  no: number;
  authorProfileId: string | null;
  displayName: string;
  body: string;
  createdAt: string;
  isAnonymous?: boolean;
  editedAt?: string;
  deletedAt?: string;
  moderatedAt?: string;
  moderationReason?: string;
  replyToPostId?: string | null;
  voteSummary?: ThreadPostVoteSummary;
}

export type ThreadPostVoteKind = "up" | "down";

export interface ThreadPostVoteSummary {
  up: number;
  down: number;
  score: number;
  viewerVote: ThreadPostVoteKind | null;
}

export type ThreadReportReason =
  "harassment" | "spam" | "privacy" | "misinformation" | "other";

export interface ThreadPostRevision {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  editReason?: string;
}

export interface ThreadPostReport {
  id: string;
  postId: string;
  reporterProfileId: string;
  reason: ThreadReportReason;
  details: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface ThreadUserControl {
  ownerProfileId: string;
  targetProfileId: string;
  muted: boolean;
  blocked: boolean;
  updatedAt: string;
}

export interface ThreadModerationReportView extends ThreadPostReport {
  postNo: number;
  threadId: string;
  threadTitle: string;
  postBody: string;
  postDeletedAt?: string;
  postModeratedAt?: string;
  authorDisplayName: string;
  reporterDisplayName: string;
}

export type SocialIdentityMode = "account" | "guest" | "anonymous";
export type ThreadIdentityMode = "anonymous" | "named" | "account";

export interface SocialPost {
  id: string;
  authorProfileId: string | null;
  displayName: string;
  handle?: string;
  identityMode: SocialIdentityMode;
  body: string;
  createdAt: string;
  replyToPostId: string | null;
  /** 返信先の投稿のハンドル（「返信先 @handle」）。親が非表示・匿名なら付かない。 */
  replyToHandle?: string;
  repostOfTargetType?: EngagementTargetType | null;
  repostOfTargetId?: string | null;
  quoteOfTargetType?: EngagementTargetType | null;
    quoteOfTargetId?: string | null;
    tags?: string[];
    images?: Array<{ id: string; url: string; width: number; height: number; altText: string }>;
    /** 他のハブから取り込んだ投稿のとき。host で出どころを示し、objectUrl で元の投稿へ戻れる。 */
    remote?: { host: string; handle: string; actorUrl: string; objectUrl: string | null };
    /** 動画へのコメントのとき、その動画（再生位置つきなら秒）。 */
    replyToVideo?: { id: string; title: string; seconds?: number | null };
    /** 動画コメントをフォロワーのフィードにも出しているか。 */
    inFeed?: boolean;
    /** 動画の持ち主が非表示にしたコメント（持ち主だけに一覧される）。 */
    hiddenByVideoOwner?: boolean;
    /** 他のハブから移転してきた投稿（「移転前の投稿」）。originalPublishedAt は元の投稿日時。verified=false は出自未確認。 */
    imported?: { originalPublishedAt: string; verified: boolean };
  }

export interface TokenBalanceEntry {
  symbol: string;
  amount: number;
  network?: string;
  contractAddress?: string;
}

export interface TokenRankingDefinition {
  id: string;
  title: string;
  symbol: string;
  network: string;
  contractAddress?: string;
  description: string;
  createdByProfileId: string;
  createdAt: string;
  verificationStatus?: "pending" | "verified" | "failed" | "not_applicable";
  lastVerifiedAt?: string;
  lastSyncedAt?: string;
  holderCount?: number;
  syncError?: string;
}

export interface BookmarkItem {
  id: string;
  targetType:
    | "thread"
    | "thread_post"
    | "social_post"
    | "community_message"
    | "vault_content";
  targetId: string;
  note: string;
}

export interface Reaction {
  id: string;
  targetType: EngagementTargetType;
  targetId: string;
  profileId: string;
  kind: ReactionKind;
  createdAt: string;
}

export interface EngagementSummary {
  targetType: EngagementTargetType;
  targetId: string;
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: ReactionKind | null;
  viewerRepostId?: string | null;
}

export interface UserList {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  order: number;
  threadIds: string[];
  profileIds: string[];
}

export interface Notification {
  id: string;
  receiverProfileId: string;
  actorProfileId: string | null;
  type: NotificationType;
  context?: NotificationContext;
  targetType: NotificationTargetType;
  targetId: string;
  text: string;
  /** 元の投稿の本文の頭（短く切ったもの）。閲覧条件つき・非公開・非表示の投稿には付かない。 */
  excerpt?: string;
  isRead: boolean;
  createdAt: string;
}

export interface MessageConversation {
  id: string;
  participantIds: string[];
  isE2ee: boolean;
  verificationStatus: VerificationStatus;
  fingerprint: string;
  unreadCountByProfileId: Record<string, number>;
  lastMessageAt: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderProfileId: string;
  encryptedPayload: string;
  previewText: string;
  encryptionVersion: string;
  encryptionState: EncryptionState;
  createdAt: string;
  images?: Array<{ id: string; url: string; fullUrl: string; width: number; height: number; altText: string }>;
}

export interface AppSnapshot {
  currentProfile: Profile;
  profiles: Profile[];
  boards: Board[];
  communities: Community[];
  communityMemberships: CommunityMembership[];
  communityChannels: CommunityChannel[];
  communityChannelMessages: CommunityChannelMessage[];
  communityChannelReactions: CommunityChannelReaction[];
  communityChannelReadStates: CommunityChannelReadState[];
  communityMessageReports?: CommunityMessageReport[];
  communityTokens?: CommunityTokenDefinition[];
  communityGuidePages?: CommunityGuidePage[];
  communityGuideDirectories?: CommunityGuideDirectory[];
  communityGuideProposals?: CommunityGuideProposal[];
  communityGuideReviews?: CommunityGuideReview[];
  communityGovernanceProposals?: CommunityGovernanceProposal[];
  communityGovernanceVotes?: CommunityGovernanceVote[];
  threads: ThreadSummary[];
  threadTracking: ThreadTracking[];
  threadPosts: ThreadPost[];
  threadPostRevisions: ThreadPostRevision[];
  threadPostReports: ThreadPostReport[];
  threadUserControls: ThreadUserControl[];
  socialPosts: SocialPost[];
  tokenBalances: Record<string, TokenBalanceEntry[]>;
  tokenRankings: TokenRankingDefinition[];
  lists: UserList[];
  bookmarks: BookmarkItem[];
  reactions: Reaction[];
  follows: FollowRelation[];
  notifications: Notification[];
  conversations: MessageConversation[];
  messages: DirectMessage[];
}
