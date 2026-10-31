"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  optimizeImageFile,
  optimizePostImageFile,
  SQUARE_AVATAR_PRESET,
} from "@/lib/client-image-optimizer";
import { EngagementBar } from "@/components/engagement-bar";
import { CommunityAppealForm } from "@/components/community-appeal-form";
import { CommunityJoinControls, type CommunityJoinMemory } from "@/components/community-join-controls";
import { CommunityGovernanceSettingsControls, type CommunityGovernanceSettings, type CommunityGovernanceSettingsMemory } from "@/components/community-governance-settings";
import { CommunityGovernanceCreateControls, type CommunityGovernanceCreateMemory } from "@/components/community-governance-create";
import { CommunityGovernanceMutationControls, type CommunityGovernanceMutationMemory, type CommunityGovernanceMutationResult } from "@/components/community-governance-mutations";
import type { CommunityGovernanceProposal } from "@/lib/domain";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { GuideVerificationControl } from "@/components/guide-verification-control";
import { PostAuthorRow, PostContentFrame } from "@/components/post-content-frame";
import { PostContextActions } from "@/components/post-context-actions";
import { TranslatedText } from "@/components/translated-text";
import {
  COMMUNITY_CATEGORIES,
  getCommunityCategoryOptions,
} from "@/lib/community-categories";
import type { HubLocale } from "@/lib/i18n";
import type {
  CommunityBoard,
  CommunityChannelMessageView,
  CommunityChannelView,
  CommunityGuideDirectoryView,
  CommunityGuidePageView,
  CommunityGuideProposalView,
  CommunityGovernanceProposalView,
  CommunityMember,
  CommunitySpace,
  CommunityTokenView,
} from "@/lib/server/community-page-data";

const CommunityGameManager = dynamic(() =>
  import("@/components/community-game-manager").then(
    (module) => module.CommunityGameManager,
  ),
);
const CommunityOperationsCenter = dynamic(() =>
  import("@/components/community-operations-center").then(
    (module) => module.CommunityOperationsCenter,
  ),
);

interface Props {
  communities: CommunitySpace[];
  members: CommunityMember[];
  boards: CommunityBoard[];
  authenticated: boolean;
  initialCommunityId?: string;
  initialChannelId?: string;
  initialMessageId?: string;
  startCreatingCommunity?: boolean;
  locale?: HubLocale;
  /*
   * v2 の本文に節だけを埋める（2026-09-07、旦那様「内側左列に節、本文に選んだ節」）。
   * 既存の左の部屋一覧は出さず、指定の節を開いた状態で始める。
   * この部品は作成・参加・会話・運営の状態を1か所で持つので、節を切り出さずに
   * 「どこを見せるか」だけを外から決める。
   */
  embedded?: CommunityEmbeddedSection;
}

export type CommunityEmbeddedSection = "members" | "guides" | "governance" | "tokens" | "settings";

function initials(name: string) {
  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase();
}

function guideDirectoryDepth(
  directory: CommunityGuideDirectoryView,
  directories: readonly CommunityGuideDirectoryView[],
) {
  const byId = new Map(directories.map((entry) => [entry.id, entry]));
  const seen = new Set([directory.id]);
  let parentId = directory.parentDirectoryId;
  let depth = 0;
  while (parentId && depth < 4 && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentDirectoryId ?? null;
  }
  return depth;
}

const MESSAGE_KIND_LABELS = {
  chat: "雑談",
  guide: "共同ページ",
  question: "質問",
  party: "募集",
} as const;

async function prepareCommunityImage(file: File): Promise<string> {
  return (await optimizeImageFile(file, SQUARE_AVATAR_PRESET)).dataUrl;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 }).format(
    value,
  );
}

function Avatar({
  name,
  url,
  small = false,
  className = "",
}: {
  name: string;
  url?: string;
  small?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`community-avatar${small ? " community-avatar--small" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}

export function CommunityWorkspace({
  communities,
  members,
  boards,
  authenticated,
  initialCommunityId,
  initialChannelId,
  initialMessageId,
  startCreatingCommunity = false,
  locale = "ja",
  embedded,
}: Props) {
  const router = useRouter();
  /* 読み手が居る面。v2 の本文に埋まったら行き先も v2 へ（2026-09-07）。 */
  const surface = useHubUiSurface();
  const initialId = communities.some(
    (community) => community.id === initialCommunityId,
  )
    ? initialCommunityId!
    : (communities[0]?.id ?? "");
  const [activeCommunityId, setActiveCommunityId] = useState(initialId);
  const [communityDetailsById, setCommunityDetailsById] = useState(
    new Map<
      string,
      {
        name: string;
        description: string;
        category: string;
        visibility?: "public" | "approval" | "private";
        knowledgeLabel: string;
        knowledgeDescription: string;
      }
    >(),
  );
  const displayCommunities = useMemo(
    () =>
      communities.map((community) => ({
        ...community,
        ...(communityDetailsById.get(community.id) ?? {}),
      })),
    [communities, communityDetailsById],
  );
  const communityCategoryOptions = useMemo(
    () =>
      getCommunityCategoryOptions(
        displayCommunities.map((community) => community.category),
      ),
    [displayCommunities],
  );
  const activeCommunity =
    displayCommunities.find(
      (community) => community.id === activeCommunityId,
    ) ?? displayCommunities[0];
  const [channelsByCommunity, setChannelsByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [community.id, community.channels]),
      ),
  );
  const [tokensByCommunity, setTokensByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [community.id, community.tokens ?? []]),
      ),
  );
  const [communityImagesById, setCommunityImagesById] = useState(
    () =>
      new Map(
        communities.flatMap((community) =>
          community.imageUrl
            ? [[community.id, community.imageUrl] as const]
            : [],
        ),
      ),
  );
  const activeChannels = activeCommunity
    ? (channelsByCommunity.get(activeCommunity.id) ?? [])
    : [];
  const [activeChannelId, setActiveChannelId] = useState(
    activeChannels.some((channel) => channel.id === initialChannelId)
      ? initialChannelId!
      : (activeChannels[0]?.id ?? ""),
  );
  const [workspaceView, setWorkspaceView] = useState<
    "home" | "posts" | "feed" | "guides" | "tokens" | "governance"
  >(
    embedded === "guides" || embedded === "governance" || embedded === "tokens"
      ? embedded
      : initialMessageId ? "posts" : initialChannelId ? "feed" : "home",
  );
  const [focusedMessageId, setFocusedMessageId] = useState(initialMessageId ?? "");
  const [communityPostSort, setCommunityPostSort] = useState<
    "popular" | "new" | "rising" | "top"
  >("popular");
  const [communityPostFilter, setCommunityPostFilter] = useState<
    "all" | "chat" | "guide" | "question" | "party"
  >("all");
  const [communityPostQuery, setCommunityPostQuery] = useState("");
  const [activeTokenId, setActiveTokenId] = useState(
    communities.find((community) => community.id === initialId)?.tokens?.[0]
      ?.id ?? "",
  );
  const activeChannel =
    activeChannels.find((channel) => channel.id === activeChannelId) ??
    activeChannels[0];
  const [messages, setMessages] = useState<CommunityChannelMessageView[]>(
    activeChannel?.messages ?? [],
  );
  const [replyingTo, setReplyingTo] =
    useState<CommunityChannelMessageView | null>(null);
  const [query, setQuery] = useState("");
  const [showCommunitySearch, setShowCommunitySearch] = useState(false);
  const [draft, setDraft] = useState("");
  const [communityImageIds, setCommunityImageIds] = useState<string[]>([]);
  const [communityImageNames, setCommunityImageNames] = useState<string[]>([]);
  const [communityImageAltTexts, setCommunityImageAltTexts] = useState<string[]>([]);
  useEffect(() => {
    if (!activeCommunity?.id || !activeChannel?.id) return;
    setDraft(localStorage.getItem(`hub.community.draft.${activeCommunity.id}.${activeChannel.id}`) ?? "");
  }, [activeChannel?.id, activeCommunity?.id]);
  useEffect(() => {
    if (!activeCommunity?.id || !activeChannel?.id) return;
    const key = `hub.community.draft.${activeCommunity.id}.${activeChannel.id}`;
    const timer = window.setTimeout(() => {
      if (draft) localStorage.setItem(key, draft);
      else localStorage.removeItem(key);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeChannel?.id, activeCommunity?.id, draft]);
  const [messageKind, setMessageKind] = useState<
    "chat" | "guide" | "question" | "party"
  >("chat");
  const [messageFilter, setMessageFilter] = useState<
    "all" | "guide" | "question" | "party"
  >("all");
  const [messageQuery, setMessageQuery] = useState("");
  const [workflowOnlyOpen, setWorkflowOnlyOpen] = useState(false);
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  /*
   * The side panel is opened, not pinned. It used to be a fourth fixed column
   * in the Discord-shaped layout; when the workspace moved to the two-column
   * shell the column was dropped from the grid but the panel stayed in the
   * markup, so it landed on an implicit second row 958px down the page and
   * moderation — promote, mute, ban — became unreachable at every width.
   *
   * null means the reader has not chosen, and the guides view brings its own
   * proposals and index panels, which have nowhere else to appear.
   */
  const [sidePanelChoice, setSidePanelChoice] = useState<boolean | null>(embedded === "members" ? true : null);
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const [collapsedRoomCategories, setCollapsedRoomCategories] = useState(
    () => new Set<string>(),
  );
  const [error, setError] = useState("");
  const [showCreateCommunity, setShowCreateCommunity] = useState(
    startCreatingCommunity,
  );
  const [showEditCommunity, setShowEditCommunity] = useState(embedded === "settings");
  const [showVisibilityConfirmation, setShowVisibilityConfirmation] =
    useState(false);
  const [showGameManager, setShowGameManager] = useState(false);
  const [showCommunityOperations, setShowCommunityOperations] = useState(false);
  const [showCommunityNotifications, setShowCommunityNotifications] = useState(false);
  const [communityNotifications, setCommunityNotifications] = useState({
    mentions: true, replies: true, guideUpdates: true, governance: true, membership: true,
  });
  const [channelNotificationModes, setChannelNotificationModes] = useState<Record<string, "all" | "mentions" | "none">>({});
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showAddToken, setShowAddToken] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [communityName, setCommunityName] = useState("");
  const [communityDescription, setCommunityDescription] = useState("");
  const [communityImageUrl, setCommunityImageUrl] = useState("");
  const [communityVisibility, setCommunityVisibility] = useState<
    "public" | "approval" | "private"
  >("public");
  const [isPreparingCommunityImage, setIsPreparingCommunityImage] =
    useState(false);
  const [editCommunityName, setEditCommunityName] = useState("");
  const [editCommunityDescription, setEditCommunityDescription] = useState("");
  const [editCommunityCategory, setEditCommunityCategory] = useState("");
  const [editCommunityVisibility, setEditCommunityVisibility] = useState<"public" | "approval" | "private">("public");
  const [editKnowledgeLabel, setEditKnowledgeLabel] = useState("");
  const [editKnowledgeDescription, setEditKnowledgeDescription] = useState("");
  const [category, setCategory] = useState<string>(COMMUNITY_CATEGORIES[0]);
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenNetwork, setTokenNetwork] = useState("");
  const [tokenContractAddress, setTokenContractAddress] = useState("");
  const [joinedById, setJoinedById] = useState(
    () =>
      new Map(communities.map((community) => [community.id, community.joined])),
  );
  const [pendingMembershipRequestById, setPendingMembershipRequestById] = useState(
    () => new Map(communities.map((community) => [
      community.id,
      community.pendingMembershipRequest ?? false,
    ])),
  );
  const [pendingMembershipCancellation, setPendingMembershipCancellation] = useState<{
    communityId: string;
    communityName: string;
    operationId: string;
  } | null>(null);
  const [membershipReceipt, setMembershipReceipt] = useState<string>("");
  const [joinCommunityId, setJoinCommunityId] = useState<string | null>(null);
  const joinMemory = useRef<CommunityJoinMemory>(new Map());
  const [appealCommunityId,setAppealCommunityId]=useState<string|null>(null);
  const [memberRolesByCommunity, setMemberRolesByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [
          community.id,
          { ...community.memberRoles },
        ]),
      ),
  );
  const [memberStatusesByCommunity, setMemberStatusesByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [
          community.id,
          { ...(community.memberStatuses ?? {}) },
        ]),
      ),
  );
  const [hiddenMemberIds, setHiddenMemberIds] = useState(
    () => new Set<string>(),
  );
  const [visibleMemberLimit, setVisibleMemberLimit] = useState(20);
  const [pendingMemberAction, setPendingMemberAction] = useState<{
    profileId: string;
    displayName: string;
    action: "promote" | "demote" | "ban";
  } | null>(null);
  const [pendingChannelDelete, setPendingChannelDelete] = useState<{
    id: string;
    name: string;
    messageCount: number;
  } | null>(null);
  const [memberActionAcknowledged, setMemberActionAcknowledged] =
    useState(false);
  const [memberProfilePopover, setMemberProfilePopover] = useState<{
    memberId: string;
    top: number;
    right: number;
  } | null>(null);
  const [reportedMessageIds, setReportedMessageIds] = useState(
    () => new Set<string>(),
  );
  const [pollOptions, setPollOptions] = useState<Array<{ messageId: string; optionId: string; label: string; voteCount: number; voted: number; closesAt?: string }>>([]);
  const [isRefreshingHoldings, setIsRefreshingHoldings] = useState(false);
  const [holdingError, setHoldingError] = useState("");
  const [guidesByCommunity, setGuidesByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [community.id, community.guides ?? []]),
      ),
  );
  const [guideProposalsByCommunity, setGuideProposalsByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [
          community.id,
          community.guideProposals ?? [],
        ]),
      ),
  );
  const [governanceByCommunity, setGovernanceByCommunity] = useState(
    () =>
      new Map(
        communities.map((community) => [
          community.id,
          community.governanceProposals ?? [],
        ]),
      ),
  );
  const [governanceSettingsByCommunity, setGovernanceSettingsByCommunity] =
    useState(
      () =>
        new Map(
          communities.map((community) => [
            community.id,
            {
              votingStrategy:
                community.governanceVotingStrategy ?? "one_member_one_vote",
              governanceTokenId: community.governanceTokenId ?? null,
              tokensPerVote: community.governanceTokensPerVote ?? 1,
              tokenRules:
                community.governanceTokenRules?.length
                  ? community.governanceTokenRules
                  : community.governanceTokenId
                    ? [
                        {
                          tokenId: community.governanceTokenId,
                          tokensPerVote:
                            community.governanceTokensPerVote ?? 1,
                          weight: 1,
                        },
                      ]
                    : [],
              voteWeightCap: community.governanceVoteCap ?? null,
            },
          ]),
        ),
    );
  const [governanceDelegateName, setGovernanceDelegateName] = useState("");
  const [showGovernanceEditor, setShowGovernanceEditor] = useState(false);
  const governanceCreateMemory = useRef<CommunityGovernanceCreateMemory>(new Map());
  const [showGovernanceSettings, setShowGovernanceSettings] = useState(false);
  const governanceSettingsMemory = useRef<CommunityGovernanceSettingsMemory>(new Map());
  const [activeGuideId, setActiveGuideId] = useState(
    communities[0]?.guides?.[0]?.id ?? "",
  );
  const [selectedGuideProposalId, setSelectedGuideProposalId] = useState<
    string | null
  >(null);
  const [showGuideProposalEditor, setShowGuideProposalEditor] = useState(false);
  const [guideProposalPageId, setGuideProposalPageId] = useState("");
  const [guideProposalTitle, setGuideProposalTitle] = useState("");
  const [guideProposedTitle, setGuideProposedTitle] = useState("");
  const [guideProposedBody, setGuideProposedBody] = useState("");
  const [guideProposedDirectoryId, setGuideProposedDirectoryId] = useState("");
  const [guideProposalSummary, setGuideProposalSummary] = useState("");
  const guideProposalRequest=useRef<{key:string;id:string}|null>(null);
  const guideProposalSaving=useRef<string|null>(null);
  const guideProposalBaseVersion=useRef(0);
  const guideProposalContext=useRef("");
  const guideReviewRequest=useRef<{key:string;id:string}|null>(null);
  const guideTransitionRequest=useRef<{key:string;id:string}|null>(null);
  const guideOperationSaving=useRef<string|null>(null);

  const [guideReviewBody, setGuideReviewBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const joined = activeCommunity
    ? (joinedById.get(activeCommunity.id) ?? false)
    : false;
  const pendingMembershipRequest = activeCommunity
    ? (pendingMembershipRequestById.get(activeCommunity.id) ?? false)
    : false;
  const canPost = joined && activeCommunity?.viewerStatus !== "muted";
  const canManageChannels =
    activeCommunity?.viewerRole === "owner" ||
    activeCommunity?.viewerRole === "moderator";
  const isOwner = activeCommunity?.viewerRole === "owner";
  const currentMember = members.find((member) => member.isCurrentUser);
  const governanceMutationMemory = useMemo<CommunityGovernanceMutationMemory>(() => new Map(), [currentMember?.id]);
  guideProposalContext.current=(activeCommunity?.id??"")+":"+(currentMember?.id??"");
  useEffect(()=>{
    guideProposalRequest.current=null;
    guideProposalSaving.current=null;
    guideReviewRequest.current=null;guideTransitionRequest.current=null;guideOperationSaving.current=null;setGuideReviewBody("");
    setShowGuideProposalEditor(false);
    setGuideProposalTitle("");setGuideProposedTitle("");setGuideProposedBody("");setGuideProposalSummary("");
  },[currentMember?.id]);

  const communityMessageHref = (
    channelId: string,
    messageId?: string,
  ) => {
    if (!activeCommunity) return "/community";
    const params = new URLSearchParams({
      community: activeCommunity.slug,
      channel: channelId,
    });
    if (messageId) params.set("message", messageId);
    return `/community?${params.toString()}`;
  };
  const openCommunityChannel = (
    channelId: string,
    messageId?: string,
  ) => {
    setActiveChannelId(channelId);
    setWorkspaceView(messageId ? "posts" : "feed");
    setFocusedMessageId(messageId ?? "");
    router.replace(communityMessageHref(channelId, messageId));
  };
  const loadPolls = async () => {
    if (!activeCommunity) return;
    const response = await fetch(`/api/communities/${activeCommunity.id}/polls`);
    const payload = await response.json().catch(() => ({})) as { options?: typeof pollOptions };
    if (response.ok) setPollOptions(payload.options ?? []);
  };
  useEffect(() => { if (activeCommunity?.id && joined) void loadPolls(); }, [activeCommunity?.id, joined]);
  const activeTokens = activeCommunity
    ? (tokensByCommunity.get(activeCommunity.id) ?? [])
    : [];
  const activeToken =
    activeTokens.find((token) => token.id === activeTokenId) ?? activeTokens[0];
  const activeGuides = activeCommunity
    ? (guidesByCommunity.get(activeCommunity.id) ?? [])
    : [];
  const activeGuideDirectories = activeCommunity?.guideDirectories ?? [];
  const activeGuideProposals = activeCommunity
    ? (guideProposalsByCommunity.get(activeCommunity.id) ?? [])
    : [];
  const activeGovernanceProposals = activeCommunity
    ? (governanceByCommunity.get(activeCommunity.id) ?? [])
    : [];
  const channelUnreadCount = activeChannels.reduce(
    (total, channel) => total + channel.unreadCount,
    0,
  );
  const roomCategoryIsOpen = (
    category: "features" | "channels" | "guides",
  ) =>
    !collapsedRoomCategories.has(`${activeCommunity?.id ?? ""}:${category}`);
  const toggleRoomCategory = (
    category: "features" | "channels" | "guides",
  ) => {
    if (!activeCommunity) return;
    const key = `${activeCommunity.id}:${category}`;
    setCollapsedRoomCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const markAllCommunityChannelsRead = async () => {
    if (!activeCommunity || channelUnreadCount === 0) return;
    const response = await fetch(
      `/api/communities/${activeCommunity.id}/read-all`,
      { method: "POST" },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error ?? "既読状態を更新できませんでした。");
      return;
    }
    setChannelsByCommunity((current) => {
      const next = new Map(current);
      next.set(
        activeCommunity.id,
        (next.get(activeCommunity.id) ?? []).map((channel) => ({
          ...channel,
          unreadCount: 0,
        })),
      );
      return next;
    });
  };
  const activeGovernanceSettings = activeCommunity
    ? (governanceSettingsByCommunity.get(activeCommunity.id) ?? {
        votingStrategy: "one_member_one_vote" as const,
        governanceTokenId: null,
        tokensPerVote: 1,
        tokenRules: [],
        voteWeightCap: null,
      })
    : null;
  const activeTokenRule = activeGovernanceSettings?.tokenRules.find(
    (rule) => rule.tokenId === activeToken?.id,
  );
  const activeTokenVotePoints =
    activeToken && activeTokenRule
      ? Math.floor(
          Math.floor(activeToken.viewerAmount / activeTokenRule.tokensPerVote) *
            activeTokenRule.weight,
        )
      : 0;
  const uncappedViewerVotePoints =
    activeGovernanceSettings?.votingStrategy === "one_member_one_vote"
      ? 1
      : Math.floor(
          activeGovernanceSettings?.tokenRules.reduce((total, rule) => {
            const token = activeTokens.find(
              (candidate) => candidate.id === rule.tokenId,
            );
            if (!token || rule.tokensPerVote <= 0 || rule.weight <= 0)
              return total;
            return (
              total +
              Math.floor(token.viewerAmount / rule.tokensPerVote) * rule.weight
            );
          }, 0) ?? 0,
        );
  const combinedViewerVotePoints =
    activeGovernanceSettings?.votingStrategy === "token_capped"
      ? Math.min(
          uncappedViewerVotePoints,
          activeGovernanceSettings.voteWeightCap ?? 100,
        )
      : uncappedViewerVotePoints;
  const knowledgeLabel = activeCommunity?.knowledgeLabel || "共同ページ";
  const knowledgeDescription =
    activeCommunity?.knowledgeDescription ||
    "コミュニティの知識をディレクトリで整理する共同ページ";
  const messageKindLabels = {
    ...MESSAGE_KIND_LABELS,
    guide: knowledgeLabel,
  };
  const activeGuide =
    activeGuides.find((guide) => guide.id === activeGuideId) ?? activeGuides[0];
  const activeGuideDirectory = activeGuide?.directoryId
    ? activeGuideDirectories.find(
        (directory) => directory.id === activeGuide.directoryId,
      )
    : null;
  const activeGuideSiblings = activeGuide
    ? activeGuides
        .filter(
          (guide) =>
            guide.id !== activeGuide.id &&
            guide.directoryId === activeGuide.directoryId,
        )
        .slice(0, 4)
    : [];
  const openGuideProposalCount = activeGuideProposals.filter(
    (proposal) =>
      proposal.status === "open" || proposal.status === "changes_requested",
  ).length;
  const selectedGuideProposal =
    activeGuideProposals.find(
      (proposal) => proposal.id === selectedGuideProposalId,
    ) ?? null;
  const pinnedMessages = useMemo(
    () =>
      messages
        .filter((message) => message.pinned)
        .sort((left, right) =>
          (right.pinnedAt ?? right.createdAt).localeCompare(
            left.pinnedAt ?? left.createdAt,
          ),
        ),
    [messages],
  );
  const visibleMessages = useMemo(() => {
    const normalizedQuery = messageQuery.trim().toLocaleLowerCase("ja");
    return messages.filter((message) => {
      const kind = message.kind ?? "chat";
      if (messageFilter !== "all" && kind !== messageFilter) return false;
      if (workflowOnlyOpen && (message.workflowStatus ?? "open") !== "open")
        return false;
      if (
        normalizedQuery &&
        !`${message.body} ${message.displayName} ${message.handle ?? ""}`
          .toLocaleLowerCase("ja")
          .includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [messageFilter, messageQuery, messages, workflowOnlyOpen]);
  const gameIndex = useMemo(
    () => ({
      guides: messages.filter((message) => (message.kind ?? "chat") === "guide")
        .length,
      unresolvedQuestions: messages.filter(
        (message) =>
          message.kind === "question" &&
          (message.workflowStatus ?? "open") === "open",
      ).length,
      recruitingParties: messages.filter(
        (message) =>
          message.kind === "party" &&
          (message.workflowStatus ?? "open") === "open",
      ).length,
    }),
    [messages],
  );
  const hasGuideContent = activeGuides.length > 0 || gameIndex.guides > 0;
  const communityMessages = useMemo(
    () =>
      Array.from(
        new Map(
          activeChannels.flatMap((channel) =>
            (channel.id === activeChannel?.id ? messages : channel.messages).map(
              (message) => [
                `${channel.id}:${message.id}`,
                {
                  ...message,
                  channelId: channel.id,
                  channelName: channel.name,
                },
              ] as const,
            ),
          ),
        ).values(),
      )
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        ),
    [activeChannel?.id, activeChannels, messages],
  );
  const communityPostResults = useMemo(() => {
    const normalizedQuery = communityPostQuery.trim().toLocaleLowerCase("ja");
    const now = Date.now();
    const scoreOf = (message: (typeof communityMessages)[number]) =>
      (message.engagement?.likeCount ?? 0) * 3 +
      (message.engagement?.replyCount ?? 0) * 2 +
      (message.pinned ? 20 : 0);
    return communityMessages
      .filter((message) => {
        if (
          communityPostFilter !== "all" &&
          (message.kind ?? "chat") !== communityPostFilter
        )
          return false;
        if (!normalizedQuery) return true;
        return `${message.body} ${message.displayName} ${message.handle ?? ""} ${message.channelName}`
          .toLocaleLowerCase("ja")
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const newest =
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime();
        if (communityPostSort === "new") return newest;
        const scoreDifference = scoreOf(right) - scoreOf(left);
        if (communityPostSort === "top") return scoreDifference || newest;
        if (communityPostSort === "rising") {
          const risingScore = (message: (typeof communityMessages)[number]) => {
            const ageHours = Math.max(
              1,
              (now - new Date(message.createdAt).getTime()) / 3_600_000,
            );
            return (scoreOf(message) + 1) / Math.pow(ageHours + 2, 1.35);
          };
          return risingScore(right) - risingScore(left) || newest;
        }
        return scoreDifference * 1_000_000 + newest;
      });
  }, [communityMessages, communityPostFilter, communityPostQuery, communityPostSort]);
  const popularChannels = useMemo(
    () =>
      [...activeChannels]
        .sort(
          (left, right) =>
            right.messages.length +
            right.unreadCount -
            (left.messages.length + left.unreadCount),
        )
        .slice(0, 4),
    [activeChannels],
  );

  const visibleCommunities = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    if (!normalized) return displayCommunities;
    return displayCommunities.filter((community) =>
      `${community.name} ${community.description} ${community.category}`
        .toLocaleLowerCase("ja")
        .includes(normalized),
    );
  }, [displayCommunities, query]);
  const joinedCommunities = useMemo(
    () =>
      visibleCommunities.filter(
        (community) => joinedById.get(community.id) === true,
      ),
    [joinedById, visibleCommunities],
  );

  const communityMembers = useMemo(() => {
    if (!activeCommunity) return [];
    return activeCommunity.memberIds
      .filter((id) => !hiddenMemberIds.has(`${activeCommunity.id}:${id}`))
      .map((id) => memberMap.get(id))
      .filter((member): member is CommunityMember => Boolean(member));
  }, [activeCommunity, hiddenMemberIds, memberMap]);
  useEffect(() => { setVisibleMemberLimit(20); }, [activeCommunity?.id]);
  const selectedMember = memberProfilePopover
    ? communityMembers.find(
        (member) => member.id === memberProfilePopover.memberId,
      ) ?? null
    : null;
  const selectedMemberRole = selectedMember
    ? (memberRolesByCommunity.get(activeCommunity?.id ?? "")?.[
        selectedMember.id
      ] ??
      activeCommunity?.memberRoles[selectedMember.id] ??
      "member")
    : "member";
  const selectedMemberStatus = selectedMember
    ? (memberStatusesByCommunity.get(activeCommunity?.id ?? "")?.[
        selectedMember.id
      ] ?? "active")
    : "active";
  const selectedMemberHoldings = selectedMember
    ? activeTokens.flatMap((token) => {
        const amount =
          token.holders.find(
            (holding) => holding.profileId === selectedMember.id,
          )?.amount ?? 0;
        return amount > 0 ? [{ symbol: token.symbol, amount }] : [];
      })
    : [];

  useEffect(() => {
    if (
      initialCommunityId
      && communities.some((community) => community.id === initialCommunityId)
    ) {
      setActiveCommunityId(initialCommunityId);
    }
  }, [communities, initialCommunityId]);

  useEffect(() => {
    setJoinedById(
      new Map(communities.map((community) => [community.id, community.joined])),
    );
    setPendingMembershipRequestById(new Map(communities.map(community => [community.id, Boolean(community.pendingMembershipRequest)])));
    setChannelsByCommunity(
      new Map(
        communities.map((community) => [community.id, community.channels]),
      ),
    );
    setTokensByCommunity(
      new Map(
        communities.map((community) => [community.id, community.tokens ?? []]),
      ),
    );
    setCommunityDetailsById(new Map());
    setCommunityImagesById(
      new Map(
        communities.flatMap((community) =>
          community.imageUrl
            ? [[community.id, community.imageUrl] as const]
            : [],
        ),
      ),
    );
    setGuidesByCommunity(
      new Map(
        communities.map((community) => [community.id, community.guides ?? []]),
      ),
    );
    setGuideProposalsByCommunity(
      new Map(
        communities.map((community) => [
          community.id,
          community.guideProposals ?? [],
        ]),
      ),
    );
    setGovernanceByCommunity(
      new Map(
        communities.map((community) => [
          community.id,
          community.governanceProposals ?? [],
        ]),
      ),
    );
    setGovernanceSettingsByCommunity(
      new Map(
        communities.map((community) => [
          community.id,
          {
            votingStrategy:
              community.governanceVotingStrategy ?? "one_member_one_vote",
            governanceTokenId: community.governanceTokenId ?? null,
            tokensPerVote: community.governanceTokensPerVote ?? 1,
            tokenRules:
              community.governanceTokenRules?.length
                ? community.governanceTokenRules
                : community.governanceTokenId
                  ? [
                      {
                        tokenId: community.governanceTokenId,
                        tokensPerVote:
                          community.governanceTokensPerVote ?? 1,
                        weight: 1,
                      },
                    ]
                  : [],
            voteWeightCap: community.governanceVoteCap ?? null,
          },
        ]),
      ),
    );
    setMemberRolesByCommunity(
      new Map(
        communities.map((community) => [
          community.id,
          { ...community.memberRoles },
        ]),
      ),
    );
    setMemberStatusesByCommunity(
      new Map(
        communities.map((community) => [
          community.id,
          { ...(community.memberStatuses ?? {}) },
        ]),
      ),
    );
  }, [communities]);

  useEffect(() => {
    setActiveChannelId((current) =>
      activeChannels.some((channel) => channel.id === current)
        ? current
        : (activeChannels[0]?.id ?? ""),
    );
    setActiveGuideId(activeGuides[0]?.id ?? "");
    setActiveTokenId(activeTokens[0]?.id ?? "");
    setSelectedGuideProposalId(null);
    setWorkspaceView(
      embedded === "guides" || embedded === "governance" || embedded === "tokens"
        ? embedded
        : initialMessageId && activeCommunity?.id === initialId
          ? "posts"
          : initialChannelId && activeCommunity?.id === initialId
            ? "feed"
            : "home",
    );
    setError("");
  }, [activeCommunity?.id, embedded]);

  useEffect(() => {
    if (!focusedMessageId || workspaceView !== "posts") return;
    const element = document.getElementById(focusedMessageId);
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: true });
    setFocusedMessageId("");
  }, [focusedMessageId, messages, workspaceView]);

  useEffect(() => {
    if (!showCommunitySearch) setQuery("");
  }, [showCommunitySearch]);

  useEffect(() => {
    setMessages(activeChannel?.messages ?? []);
    setDraft("");
    setMessageKind("chat");
    setMessageFilter("all");
    setMessageQuery("");
    setWorkflowOnlyOpen(false);
    setShowPinnedMessages(false);
    setReplyingTo(null);
    if (!activeCommunity || !activeChannel) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          messages?: Array<{
            id: string;
            authorProfileId: string;
            botId?: string | null;
            botName?: string | null;
            body: string;
            createdAt: string;
            editedAt?: string | null;
            replyToMessageId?: string | null;
            kind?: "chat" | "guide" | "question" | "party";
            pinnedAt?: string | null;
            workflowStatus?: "open" | "resolved" | "closed";
          }>;
        };
        if (!stopped && Array.isArray(payload.messages)) {
          setMessages((current) => {
            const currentMap = new Map(
              current.map((message) => [message.id, message]),
            );
            const rawMap = new Map(
              payload.messages!.map((message) => [message.id, message]),
            );
            return payload.messages!.map((message) => {
              const author = memberMap.get(message.authorProfileId);
              const existing = currentMap.get(message.id);
              const replyTarget = message.replyToMessageId
                ? rawMap.get(message.replyToMessageId)
                : undefined;
              const replyAuthor = replyTarget
                ? memberMap.get(replyTarget.authorProfileId)
                : undefined;
              return {
                ...message,
                displayName: author?.displayName ?? "Unknown",
                handle: author?.handle,
                avatarUrl: author?.avatarUrl,
                replyTo:
                  existing?.replyTo ??
                  (replyTarget
                    ? {
                        id: replyTarget.id,
                        displayName: replyAuthor?.displayName ?? "Unknown",
                        body: replyTarget.body,
                      }
                    : undefined),
                reactions: existing?.reactions ?? [],
                kind: message.kind ?? existing?.kind ?? "chat",
                pinned:
                  message.pinnedAt !== undefined
                    ? Boolean(message.pinnedAt)
                    : existing?.pinned,
                pinnedAt:
                  message.pinnedAt !== undefined
                    ? message.pinnedAt
                    : existing?.pinnedAt,
                workflowStatus:
                  message.workflowStatus ?? existing?.workflowStatus ?? "open",
                engagement: existing?.engagement ?? {
                  replyCount: 0,
                  likeCount: 0,
                  liked: false,
                  bookmarked: false,
                },
              };
            });
          });
          const lastMessageId = payload.messages.at(-1)?.id ?? null;
          if (joined && lastMessageId) {
            void fetch(
              `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/read`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ last_message_id: lastMessageId }),
              },
            );
            setChannelsByCommunity((current) => {
              const next = new Map(current);
              next.set(
                activeCommunity.id,
                (next.get(activeCommunity.id) ?? []).map((channel) =>
                  channel.id === activeChannel.id
                    ? { ...channel, unreadCount: 0 }
                    : channel,
                ),
              );
              return next;
            });
          }
        }
      } catch {
        // The seeded channel content remains visible while reconnection is attempted.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeChannel?.id, activeCommunity?.id, joined, memberMap]);

  const selectCommunity = (communityId: string, slug: string) => {
    setActiveCommunityId(communityId);
    setShowCommunitySearch(false);
    setQuery("");
    setError("");
    router.replace(
      `/community?community=${encodeURIComponent(slug)}`,
    );
  };

  useEffect(() => { setJoinCommunityId(null); }, [activeCommunity?.id, currentMember?.id, authenticated]);
  useEffect(() => { joinMemory.current.clear(); }, [currentMember?.id, authenticated]);
  useEffect(() => {
    const changed = () => { joinMemory.current.clear(); setJoinCommunityId(null); };
    window.addEventListener("hub-account-changed", changed);
    return () => window.removeEventListener("hub-account-changed", changed);
  }, []);

  const toggleMembership = () => {
    if (!activeCommunity) return;
    if (!authenticated) {
      const next = `/community?community=${encodeURIComponent(activeCommunity.slug)}`;
      router.push(`/auth?next=${encodeURIComponent(next)}`);
      return;
    }
    if (pendingMembershipRequest) {
      setPendingMembershipCancellation({
        communityId: activeCommunity.id,
        communityName: activeCommunity.name,
        operationId: crypto.randomUUID(),
      });
      return;
    }
    if (!joined) { setJoinCommunityId(activeCommunity.id); return; }
    setError("");
    setMembershipReceipt("");
    startTransition(async () => {
      const response = await fetch(`/api/communities/${activeCommunity.id}/membership`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        joined?: boolean;
        pending?: boolean;
      };
      if (!response.ok || typeof payload.joined !== "boolean") {
        setError(payload.error ?? "参加状態を更新できませんでした。");
        return;
      }
      setJoinedById((current) =>
        new Map(current).set(activeCommunity.id, payload.joined!),
      );
      setPendingMembershipRequestById((current) =>
        new Map(current).set(activeCommunity.id, payload.pending === true),
      );
      router.refresh();
    });
  };

  const cancelMembershipRequest = () => {
    if (!pendingMembershipCancellation || isPending) return;
    setError("");
    setMembershipReceipt("");
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${pendingMembershipCancellation.communityId}/membership`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId: pendingMembershipCancellation.operationId }),
        },
      );
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        pending?: boolean;
        receipt?: { auditId?: string };
      };
      if (!response.ok || payload.pending !== false || !payload.receipt?.auditId) {
        setError(payload.error ?? "参加申請を取り消せませんでした。");
        return;
      }
      setPendingMembershipRequestById((current) =>
        new Map(current).set(pendingMembershipCancellation.communityId, false),
      );
      setMembershipReceipt(`参加申請を取り消しました。監査番号: ${payload.receipt.auditId}`);
      setPendingMembershipCancellation(null);
      router.refresh();
    });
  };

  const submitCommunityAppeal = async () => {
    if (!activeCommunity) return;
    setAppealCommunityId(activeCommunity.id);
  };

  const reportDuplicateCommunity = async () => {
    if (!activeCommunity) return;
    const targetName = window.prompt("重複しているコミュニティ名を入力してください。")?.trim();
    if (!targetName) return;
    const target = communities.find((community) => community.id !== activeCommunity.id && community.name.toLocaleLowerCase("ja") === targetName.toLocaleLowerCase("ja"));
    if (!target) { setError("該当するコミュニティが見つかりません。"); return; }
    const reason = window.prompt("重複だと考える理由を10文字以上で入力してください。")?.trim();
    if (!reason) return;
    const response = await fetch(`/api/communities/${activeCommunity.id}/duplicates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetCommunityId: target.id, reason }) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setError(response.ok ? "重複コミュニティとして報告しました。" : payload.error ?? "重複報告を送信できませんでした。");
  };

  const uploadCommunityImages = async (files: FileList | null) => {
    for (const file of Array.from(files ?? []).slice(0, 4 - communityImageIds.length)) {
      try {
        const optimized = await optimizePostImageFile(file);
        const form = new FormData();
        form.set("image", optimized.image); form.set("thumbnail", optimized.thumbnail);
        form.set("width", String(optimized.width)); form.set("height", String(optimized.height));
        form.set("thumbnailWidth", String(optimized.thumbnailWidth)); form.set("thumbnailHeight", String(optimized.thumbnailHeight));
        form.set("altText", file.name);
        const response = await fetch("/api/media/images", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({})) as { image?: { id: string }; error?: string };
        if (!response.ok || !payload.image) throw new Error(payload.error ?? "画像を追加できませんでした。");
        setCommunityImageIds((current) => [...current, payload.image!.id]);
        setCommunityImageNames((current) => [...current, file.name]);
        setCommunityImageAltTexts((current) => [...current, file.name]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "画像を追加できませんでした。");
      }
    }
  };

  const saveCommunityImageAltText = async (index: number) => {
    const imageId = communityImageIds[index];
    if (!imageId) return;
    const response = await fetch(`/api/media/images/${encodeURIComponent(imageId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ altText: communityImageAltTexts[index] ?? "" }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error ?? "画像の説明を保存できませんでした。");
    }
  };

  const submitMessage = () => {
    if (!activeCommunity || !activeChannel || !canPost || !draft.trim()) return;
    if (draft.trim().length > 2000) {
      setError("メッセージは2000文字以内で入力してください。");
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: draft.trim(),
            reply_to_message_id: replyingTo?.id ?? null,
            kind: messageKind,
            ...(communityImageIds.length ? { image_ids: communityImageIds } : {}),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: {
          id: string;
          authorProfileId: string;
          body: string;
          createdAt: string;
          kind?: "chat" | "guide" | "question" | "party";
        };
      };
      if (!response.ok || !payload.message) {
        setError(payload.error ?? "メッセージを送信できませんでした。");
        return;
      }
      const me = members.find((member) => member.isCurrentUser);
      setMessages((current) => [
        ...current,
        {
          ...payload.message!,
          kind: payload.message!.kind ?? messageKind,
          pinned: false,
          displayName: me?.displayName ?? "Unknown",
          handle: me?.handle,
          avatarUrl: me?.avatarUrl,
          replyTo: replyingTo
            ? {
                id: replyingTo.id,
                displayName: replyingTo.displayName,
                body: replyingTo.body,
              }
            : undefined,
          reactions: [],
          engagement: {
            replyCount: 0,
            likeCount: 0,
            liked: false,
            bookmarked: false,
          },
        },
      ]);
      setCommunityImageIds([]);
      setCommunityImageNames([]);
      setCommunityImageAltTexts([]);
      setDraft("");
      setMessageKind("chat");
      setReplyingTo(null);
    });
  };

  const createPoll = () => {
    if (!activeCommunity || !activeChannel || !canPost) return;
    const question = window.prompt("アンケートの質問を入力してください。")?.trim();
    if (!question) return;
    const rawOptions = window.prompt("選択肢をカンマ区切りで2件以上入力してください。")?.trim();
    const options = rawOptions?.split(/[、,]/).map((item) => item.trim()).filter(Boolean) ?? [];
    if (options.length < 2) return setError("選択肢を2件以上入力してください。");
    startTransition(async () => {
      const response = await fetch(`/api/communities/${activeCommunity.id}/polls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId: activeChannel.id, question, options, closesInHours: 72 }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: { id: string; authorProfileId: string; body: string; createdAt: string } };
      if (!response.ok || !payload.message) return setError(payload.error ?? "アンケートを作成できませんでした。");
      setMessages((current) => [...current, { ...payload.message!, displayName: currentMember?.displayName ?? "Unknown", handle: currentMember?.handle, avatarUrl: currentMember?.avatarUrl, kind: "chat", pinned: false, reactions: [], engagement: { replyCount: 0, likeCount: 0, liked: false, bookmarked: false } }]);
      await loadPolls();
    });
  };

  const votePoll = (optionId: string) => {
    if (!activeCommunity) return;
    startTransition(async () => {
      const response = await fetch(`/api/communities/${activeCommunity.id}/polls`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ optionId }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); return setError(payload.error ?? "投票できませんでした。"); }
      await loadPolls();
    });
  };

  const scheduleCurrentDraft = () => {
    if (!activeCommunity || !activeChannel || !draft.trim()) return;
    const raw = window.prompt("公開日時を入力してください（例：2026-07-20 20:00）");
    if (!raw) return;
    const scheduledAt = new Date(raw.replace(" ", "T"));
    if (!Number.isFinite(scheduledAt.getTime())) return setError("公開日時を確認してください。");
    startTransition(async () => {
      const response = await fetch(`/api/communities/${activeCommunity.id}/scheduled`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId: activeChannel.id, body: draft.trim(), kind: messageKind, scheduledAt: scheduledAt.toISOString() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error ?? "予約投稿を作成できませんでした。");
      setDraft(""); setMessageKind("chat");
    });
  };

  const togglePostEngagement = (
    messageId: string,
    action: "like" | "bookmark",
  ) => {
    if (!canPost) return;
    const message = messages.find((candidate) => candidate.id === messageId);
    const active = action === "like"
      ? !message?.engagement?.liked
      : !message?.engagement?.bookmarked;
    setError("");
    startTransition(async () => {
      const response = await fetch(
        `/api/engagements/${action === "like" ? "reaction" : "bookmark"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_type: "community_message",
            target_id: messageId,
            ...(action === "like" ? { kind: "like" } : {}),
            active,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        summary?: {
          replyCount: number;
          repostCount: number;
          quoteRepostCount: number;
          likeCount: number;
          viewerReaction: "like" | null;
          bookmarked: boolean;
        };
      };
      if (!response.ok || !payload.summary) {
        setError(
          payload.error ??
            (action === "like"
              ? "いいねを更新できませんでした。"
              : "保存状態を更新できませんでした。"),
        );
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                engagement: {
                  replyCount: payload.summary!.replyCount,
                  repostCount: payload.summary!.repostCount,
                  quoteRepostCount: payload.summary!.quoteRepostCount,
                  likeCount: payload.summary!.likeCount,
                  liked: payload.summary!.viewerReaction === "like",
                  bookmarked: payload.summary!.bookmarked,
                },
              }
            : message,
        ),
      );
      if (activeCommunity) {
        setChannelsByCommunity((current) => {
          const next = new Map(current);
          next.set(
            activeCommunity.id,
            (next.get(activeCommunity.id) ?? []).map((channel) => ({
              ...channel,
              messages: channel.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      engagement: {
                        replyCount: payload.summary!.replyCount,
                        repostCount: payload.summary!.repostCount,
                        quoteRepostCount: payload.summary!.quoteRepostCount,
                        likeCount: payload.summary!.likeCount,
                        liked: payload.summary!.viewerReaction === "like",
                        bookmarked: payload.summary!.bookmarked,
                      },
                    }
                  : message,
              ),
            })),
          );
          return next;
        });
      }
    });
  };

  const createChannel = () => {
    if (!activeCommunity || !channelName.trim()) return;
    setError("");
    startTransition(async () => {
      const endpoint = editingChannelId
        ? `/api/communities/${activeCommunity.id}/channels/${editingChannelId}`
        : `/api/communities/${activeCommunity.id}/channels`;
      const response = await fetch(endpoint, {
        method: editingChannelId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: channelName.trim(),
          description: channelDescription.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        channel?: Omit<CommunityChannelView, "messages">;
      };
      if (!response.ok || !payload.channel) {
        setError(payload.error ?? "チャンネルを作成できませんでした。");
        return;
      }
      setChannelsByCommunity((current) => {
        const next = new Map(current);
        const existing = next.get(activeCommunity.id) ?? [];
        next.set(
          activeCommunity.id,
          editingChannelId
            ? existing.map((channel) =>
                channel.id === editingChannelId
                  ? { ...channel, ...payload.channel }
                  : channel,
              )
            : [
                ...existing,
                { ...payload.channel!, unreadCount: 0, messages: [] },
              ],
        );
        return next;
      });
      setActiveChannelId(payload.channel.id);
      setShowCreateChannel(false);
      setEditingChannelId(null);
      setChannelName("");
      setChannelDescription("");
    });
  };

  const openChannelEditor = (channel: CommunityChannelView) => {
    setEditingChannelId(channel.id);
    setChannelName(channel.name);
    setChannelDescription(channel.description);
    setError("");
    setShowCreateChannel(true);
  };

  const moveChannel = (channelId: string, direction: "up" | "down") => {
    if (!activeCommunity) return;
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${channelId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        channels?: Array<
          Omit<CommunityChannelView, "messages" | "unreadCount">
        >;
      };
      if (!response.ok || !payload.channels) {
        setError(payload.error ?? "チャンネルを移動できませんでした。");
        return;
      }
      setChannelsByCommunity((current) => {
        const next = new Map(current);
        const existing = new Map(
          (next.get(activeCommunity.id) ?? []).map((channel) => [
            channel.id,
            channel,
          ]),
        );
        next.set(
          activeCommunity.id,
          payload.channels!.map((channel) => ({
            ...existing.get(channel.id)!,
            ...channel,
          })),
        );
        return next;
      });
    });
  };

  const removeChannel = (channelId: string) => {
    if (!activeCommunity) return;
    const operationId = crypto.randomUUID();
    const channel = activeChannels.find((entry) => entry.id === channelId);
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${channelId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId,
            note: `チャンネル #${channel?.name ?? channelId} の削除を確認`,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "チャンネルを削除できませんでした。");
        return;
      }
      setPendingChannelDelete(null);
      setChannelsByCommunity((current) => {
        const next = new Map(current);
        next.set(
          activeCommunity.id,
          (next.get(activeCommunity.id) ?? []).filter(
            (channel) => channel.id !== channelId,
          ),
        );
        return next;
      });
      if (activeChannelId === channelId)
        setActiveChannelId(
          activeChannels.find((channel) => channel.id !== channelId)?.id ?? "",
        );
    });
  };

  const editMessage = (message: CommunityChannelMessageView) => {
    if (!activeCommunity || !activeChannel) return;
    const body = window.prompt("メッセージを編集", message.body)?.trim();
    if (!body || body === message.body) return;
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages/${message.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: { body: string; editedAt?: string | null };
      };
      if (!response.ok || !payload.message) {
        setError(payload.error ?? "メッセージを編集できませんでした。");
        return;
      }
      setMessages((current) =>
        current.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                body: payload.message!.body,
                editedAt: payload.message!.editedAt,
              }
            : entry,
        ),
      );
    });
  };

  const removeMessage = (messageId: string) => {
    if (
      !activeCommunity ||
      !activeChannel ||
      !window.confirm("このメッセージを削除しますか？")
    )
      return;
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages/${messageId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "メッセージを削除できませんでした。");
        return;
      }
      setMessages((current) =>
        current.filter((entry) => entry.id !== messageId),
      );
    });
  };

  const reportMessage = (messageId: string) => {
    if (!activeCommunity || !activeChannel) return;
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages/${messageId}/reports`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "other" }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "通報を送信できませんでした。");
        return;
      }
      setReportedMessageIds((current) => new Set(current).add(messageId));
    });
  };

  const togglePinnedMessage = (message: CommunityChannelMessageView) => {
    if (!activeCommunity || !activeChannel || !canManageChannels) return;
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages/${message.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: !message.pinned }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: { pinnedAt?: string | null };
      };
      if (!response.ok || !payload.message) {
        setError(payload.error ?? "固定状態を更新できませんでした。");
        return;
      }
      setMessages((current) =>
        current.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                pinned: Boolean(payload.message!.pinnedAt),
                pinnedAt: payload.message!.pinnedAt,
              }
            : entry,
        ),
      );
    });
  };

  const toggleMessageWorkflow = (message: CommunityChannelMessageView) => {
    if (!activeCommunity || !activeChannel) return;
    const kind = message.kind ?? "chat";
    if (kind !== "question" && kind !== "party") return;
    const currentStatus = message.workflowStatus ?? "open";
    const nextStatus =
      kind === "question"
        ? currentStatus === "resolved"
          ? "open"
          : "resolved"
        : currentStatus === "closed"
          ? "open"
          : "closed";
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/channels/${activeChannel.id}/messages/${message.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow_status: nextStatus }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: { workflowStatus?: "open" | "resolved" | "closed" };
      };
      if (!response.ok || !payload.message) {
        setError(payload.error ?? "投稿状態を更新できませんでした。");
        return;
      }
      setMessages((current) =>
        current.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                workflowStatus: payload.message!.workflowStatus ?? nextStatus,
              }
            : entry,
        ),
      );
    });
  };

  const manageMember = (
    profileId: string,
    action: "promote" | "demote" | "mute" | "unmute" | "ban",
  ) => {
    if (!activeCommunity) return;
    const operationId = crypto.randomUUID();
    const targetLabel =
      pendingMemberAction?.profileId === profileId
        ? pendingMemberAction.displayName
        : profileId;
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/members/${profileId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            operationId,
            note: `${targetLabel}への${action}操作を確認`,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        member?: {
          role: "owner" | "moderator" | "member";
          status: "active" | "muted" | "banned";
        };
      };
      if (!response.ok || !payload.member) {
        setError(payload.error ?? "メンバーを更新できませんでした。");
        return;
      }
      setMemberRolesByCommunity((current) => {
        const next = new Map(current);
        next.set(activeCommunity.id, {
          ...(next.get(activeCommunity.id) ?? {}),
          [profileId]: payload.member!.role,
        });
        return next;
      });
      setMemberStatusesByCommunity((current) => {
        const next = new Map(current);
        next.set(activeCommunity.id, {
          ...(next.get(activeCommunity.id) ?? {}),
          [profileId]: payload.member!.status === "muted" ? "muted" : "active",
        });
        return next;
      });
      if (payload.member.status === "banned")
        setHiddenMemberIds((current) =>
          new Set(current).add(`${activeCommunity.id}:${profileId}`),
        );
      setPendingMemberAction(null);
      setMemberActionAcknowledged(false);
    });
  };

  const requestSensitiveMemberAction = (
    profileId: string,
    displayName: string,
    action: "promote" | "demote" | "ban",
  ) => {
    setError("");
    setMemberActionAcknowledged(false);
    setPendingMemberAction({ profileId, displayName, action });
  };

  const refreshTokenHoldings = async () => {
    if (!activeCommunity || !activeTokens.length || isRefreshingHoldings)
      return;
    setHoldingError("");
    setIsRefreshingHoldings(true);
    try {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/tokens/holdings`,
        { method: "POST", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        source?: "development" | "provider";
        verifiedAt?: string;
        expiresAt?: string;
        tokens?: CommunityTokenView[];
      };
      if (!response.ok || !payload.tokens) {
        setHoldingError(payload.error ?? "保有量を確認できませんでした。");
        return;
      }
      const verifiedTokens = payload.tokens.map((token) => ({
        ...token,
        verifiedAt: token.verifiedAt ?? payload.verifiedAt,
        expiresAt: token.expiresAt ?? payload.expiresAt,
        verificationSource: token.verificationSource ?? payload.source,
      }));
      setTokensByCommunity((current) =>
        new Map(current).set(activeCommunity.id, verifiedTokens),
      );
    } catch {
      setHoldingError(
        "保有量を確認できませんでした。時間をおいて再度お試しください。",
      );
    } finally {
      setIsRefreshingHoldings(false);
    }
  };

  const addCommunityToken = () => {
    if (
      !activeCommunity ||
      !tokenName.trim() ||
      !tokenSymbol.trim() ||
      !tokenNetwork.trim()
    )
      return;
    setError("");
    startTransition(async () => {
      const response = await fetch(
        `/api/communities/${activeCommunity.id}/tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tokenName.trim(),
            symbol: tokenSymbol.trim().toUpperCase(),
            network: tokenNetwork.trim(),
            contract_address: tokenContractAddress.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        token?: {
          id: string;
          name: string;
          symbol: string;
          network: string;
          contractAddress?: string;
        };
      };
      if (!response.ok || !payload.token) {
        setError(payload.error ?? "トークンを登録できませんでした。");
        return;
      }
      const token: CommunityTokenView = {
        ...payload.token,
        totalAmount: 0,
        holderCount: 0,
        viewerAmount: 0,
        holders: [],
      };
      setTokensByCommunity((current) => {
        const next = new Map(current);
        next.set(activeCommunity.id, [
          ...(next.get(activeCommunity.id) ?? []),
          token,
        ]);
        return next;
      });
      setTokenName("");
      setTokenSymbol("");
      setTokenNetwork("");
      setTokenContractAddress("");
      setShowAddToken(false);
    });
  };

  const createCommunity = () => {
    if (
      communityName.trim().length < 3 ||
      communityDescription.trim().length < 10
    ) {
      setError(
        "コミュニティ名は3文字以上、説明は10文字以上で入力してください。",
      );
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: communityName.trim(),
          description: communityDescription.trim(),
          category,
          imageUrl: communityImageUrl || undefined,
          visibility: communityVisibility,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        community?: { id: string };
      };
      if (!response.ok || !payload.community) {
        setError(payload.error ?? "コミュニティを作成できませんでした。");
        return;
      }
      setActiveCommunityId(payload.community.id);
      setShowCreateCommunity(false);
      setCommunityName("");
      setCommunityDescription("");
      setCommunityImageUrl("");
      setCommunityVisibility("public");
      router.refresh();
    });
  };

  const selectCommunityImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setIsPreparingCommunityImage(true);
    try {
      setCommunityImageUrl(await prepareCommunityImage(file));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "画像を確認できませんでした。",
      );
    } finally {
      setIsPreparingCommunityImage(false);
      event.target.value = "";
    }
  };

  const updateActiveCommunityImage = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file || !activeCommunity || !isOwner) return;
    setError("");
    setIsPreparingCommunityImage(true);
    try {
      const imageUrl = await prepareCommunityImage(file);
      const response = await fetch(`/api/communities/${activeCommunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "画像を更新できませんでした。");
      setCommunityImagesById((current) =>
        new Map(current).set(activeCommunity.id, imageUrl),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "画像を更新できませんでした。",
      );
    } finally {
      setIsPreparingCommunityImage(false);
      event.target.value = "";
    }
  };

  const openCommunityEditor = () => {
    if (!activeCommunity || !isOwner) return;
    setShowVisibilityConfirmation(false);
    setEditCommunityName(activeCommunity.name);
    setEditCommunityDescription(activeCommunity.description);
    setEditCommunityCategory(activeCommunity.category);
    setEditCommunityVisibility(activeCommunity.visibility ?? "public");
    setEditKnowledgeLabel(activeCommunity.knowledgeLabel || "共同ページ");
    setEditKnowledgeDescription(
      activeCommunity.knowledgeDescription ||
        "コミュニティの知識をディレクトリで整理する共同ページ",
    );
    setError("");
    setShowEditCommunity(true);
  };

  const openCommunityNotifications = () => {
    if (!activeCommunity || !joined) return;
    setError("");
    setShowCommunityNotifications(true);
    void fetch(`/api/communities/${activeCommunity.id}/notifications`)
      .then((response) => response.json())
      .then((payload: { preferences?: typeof communityNotifications; channels?: Array<{ channelId: string; mode: "all" | "mentions" | "none" }> }) => {
        if (payload.preferences) setCommunityNotifications(payload.preferences);
        if (payload.channels) setChannelNotificationModes(Object.fromEntries(payload.channels.map((item) => [item.channelId, item.mode])));
      });
  };

  const saveCommunityNotifications = () => {
    if (!activeCommunity) return;
    startTransition(async () => {
      const response = await fetch(`/api/communities/${activeCommunity.id}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...communityNotifications, channels: activeChannels.map((channel) => ({ channelId: channel.id, mode: channelNotificationModes[channel.id] ?? "mentions" })) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) return setError(payload.error ?? "通知設定を更新できませんでした。");
      setShowCommunityNotifications(false);
    });
  };

  const saveCommunityDetails = (visibilityConfirmed = false) => {
    if (!activeCommunity || !isOwner) return;
    const name = editCommunityName.trim();
    const description = editCommunityDescription.trim();
    const category = editCommunityCategory.trim();
    const nextKnowledgeLabel = editKnowledgeLabel.trim();
    const nextKnowledgeDescription = editKnowledgeDescription.trim();
    if (
      name.length < 3 ||
      description.length < 10 ||
      !category ||
      !nextKnowledgeLabel ||
      !nextKnowledgeDescription
    ) {
      setError(
        "コミュニティ名は3文字以上、説明は10文字以上で入力してください。",
      );
      return;
    }
    const previousVisibility = activeCommunity.visibility ?? "public";
    if (
      editCommunityVisibility !== previousVisibility &&
      !visibilityConfirmed
    ) {
      setError("");
      setShowVisibilityConfirmation(true);
      return;
    }
    const operationId = crypto.randomUUID();
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/communities/${activeCommunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          category,
          visibility: editCommunityVisibility,
          knowledgeLabel: nextKnowledgeLabel,
          knowledgeDescription: nextKnowledgeDescription,
          operationId,
          note:
            editCommunityVisibility !== previousVisibility
              ? `公開範囲を${previousVisibility}から${editCommunityVisibility}へ変更することを確認`
              : "コミュニティ設定の変更を確認",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "コミュニティを更新できませんでした。");
        return;
      }
      setCommunityDetailsById((current) =>
        new Map(current).set(activeCommunity.id, {
          name,
          description,
          category,
          visibility: editCommunityVisibility,
          knowledgeLabel: nextKnowledgeLabel,
          knowledgeDescription: nextKnowledgeDescription,
        }),
      );
      setShowEditCommunity(false);
      setShowVisibilityConfirmation(false);
      router.refresh();
    });
  };

  const openGuideProposalEditor = (page?: CommunityGuidePageView) => {
    guideProposalBaseVersion.current=page?.version??0;
    guideProposalRequest.current=null;

    setActiveGuideId(page?.id ?? "");
    setGuideProposalPageId(page?.id ?? "");
    setGuideProposalTitle(page ? `${Array.from(page.title).slice(0,57).join("")}を更新` : "");
    setGuideProposedTitle(page?.title ?? "");
    setGuideProposedBody(page?.body ?? "");
    setGuideProposedDirectoryId(page?.directoryId ?? "");
    setGuideProposalSummary("");
    setError("");
    setShowGuideProposalEditor(true);
  };

  const submitGuideProposal = () => {
    if (!activeCommunity || !currentMember || !canPost || guideProposalSaving.current) return;
    const input={pageId:guideProposalPageId||null,proposedDirectoryId:guideProposedDirectoryId||null,title:guideProposalTitle,
      proposedTitle:guideProposedTitle,proposedBody:guideProposedBody,summary:guideProposalSummary,baseVersion:guideProposalBaseVersion.current};
    const context=guideProposalContext.current,key=context+JSON.stringify(input);
    if(guideProposalRequest.current?.key!==key)guideProposalRequest.current={key,id:crypto.randomUUID()};
    const requestId=guideProposalRequest.current.id;
    guideProposalSaving.current=requestId;setError("");
    startTransition(async()=>{
      try{
        const response=await fetch("/api/communities/"+activeCommunity.id+"/guides",{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,requestId}),signal:AbortSignal.timeout(15000)
        });
        const payload=await response.json().catch(()=>({})) as {error?:string;proposal?:Omit<CommunityGuideProposalView,"authorName"|"reviews"> & {communityId:string}};
        if(guideProposalContext.current!==context)return;
        if(!response.ok||payload.proposal?.id!==requestId||payload.proposal.communityId!==activeCommunity.id){
          setError(payload.error??"編集案の保存結果を確認できませんでした。同じ内容で再試行してください。");return;
        }
        const proposal:CommunityGuideProposalView={...payload.proposal,authorName:currentMember.displayName,reviews:[]};
        setGuideProposalsByCommunity(current=>new Map(current).set(activeCommunity.id,[proposal,...(current.get(activeCommunity.id)??[]).filter(item=>item.id!==proposal.id)]));
        guideProposalRequest.current=null;
        setGuideProposedBody("");setGuideProposalSummary("");
        setSelectedGuideProposalId(proposal.id);setShowGuideProposalEditor(false);setWorkspaceView("guides");
      }catch{
        if(guideProposalContext.current===context)setError("保存結果を確認できませんでした。下書きは残っています。同じ内容で再試行してください。");
      }finally{if(guideProposalSaving.current===requestId)guideProposalSaving.current=null;}
    });
  };

  const runGuideOperation = (proposal: CommunityGuideProposalView, action: "merge"|"close"|"reopen"|"comment"|"approve"|"request_changes", review=false) => {
    if(!activeCommunity||!currentMember||guideOperationSaving.current||review&&!guideReviewBody.trim())return;
    const context=guideProposalContext.current,input=review?{body:guideReviewBody,decision:action,expectedUpdatedAt:proposal.updatedAt}:{action,expectedUpdatedAt:proposal.updatedAt};
    const request=review?guideReviewRequest:guideTransitionRequest,key=context+proposal.id+JSON.stringify(input);
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};const requestId=request.current.id;
    guideOperationSaving.current=requestId;setError("");
    startTransition(async()=>{
      try{
        const response=await fetch("/api/communities/"+activeCommunity.id+"/guides/proposals/"+proposal.id+(review?"/reviews":""),{
          method:review?"POST":"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,requestId}),signal:AbortSignal.timeout(15000)
        });
        type Page={id:string;directoryId?:string|null;slug:string;title:string;body:string;version:number;updatedAt:string};
        const payload=await response.json().catch(()=>({})) as {error?:string;operationId?:string;proposal?:{id:string;communityId:string;status:CommunityGuideProposalView["status"];updatedAt:string;pageId?:string|null};review?:{id:string;authorProfileId:string;body:string;decision:"comment"|"approve"|"request_changes";createdAt:string};page?:Page;pages?:Page[]};
        if(guideProposalContext.current!==context)return;
        if(!response.ok||payload.operationId!==requestId||payload.proposal?.id!==proposal.id||payload.proposal.communityId!==activeCommunity.id||review&&payload.review?.id!==requestId){setError(payload.error??"保存結果を確認できませんでした。同じ内容で再試行してください。");return;}
        setGuideProposalsByCommunity(current=>new Map(current).set(activeCommunity.id,(current.get(activeCommunity.id)??[]).map(entry=>entry.id!==proposal.id?entry:{...entry,...payload.proposal!,
          reviews:payload.review?[...entry.reviews.filter(item=>item.id!==payload.review!.id),{...payload.review,authorName:currentMember.displayName}]:entry.reviews})));
        const page=payload.page,pages=payload.pages;
        if(page)setGuidesByCommunity(current=>new Map(current).set(activeCommunity.id,[{...page,updatedBy:currentMember.displayName},...(current.get(activeCommunity.id)??[]).filter(item=>item.id!==page.id)]));
        else if(pages)setGuidesByCommunity(current=>new Map(current).set(activeCommunity.id,pages.map(item=>({...item,updatedBy:currentMember.displayName}))));
        request.current=null;if(review)setGuideReviewBody("");
      }catch{if(guideProposalContext.current===context)setError("保存結果を確認できませんでした。入力は残っています。同じ内容で再試行してください。");}
      finally{if(guideOperationSaving.current===requestId)guideOperationSaving.current=null;}
    });
  };
  const updateGuideProposal=(proposal:CommunityGuideProposalView,action:"merge"|"close"|"reopen")=>runGuideOperation(proposal,action);
  const submitGuideReview=(proposal:CommunityGuideProposalView,decision:"comment"|"approve"|"request_changes")=>runGuideOperation(proposal,decision,true);

  useEffect(() => { setShowGovernanceSettings(false); }, [activeCommunity?.id, currentMember?.id]);
  useEffect(() => { setShowGovernanceEditor(false); }, [activeCommunity?.id, currentMember?.id]);
  useEffect(() => { governanceSettingsMemory.current.clear(); }, [currentMember?.id]);
  useEffect(() => { governanceCreateMemory.current.clear(); }, [currentMember?.id]);
  useEffect(() => {
    const changed = () => { governanceMutationMemory.clear(); governanceSettingsMemory.current.clear(); setShowGovernanceSettings(false); governanceCreateMemory.current.clear(); setShowGovernanceEditor(false); };
    window.addEventListener("hub-account-changed", changed);
    return () => window.removeEventListener("hub-account-changed", changed);
  }, [governanceMutationMemory]);
  const openGovernanceSettings = () => { setError(""); setShowGovernanceSettings(true); };

  const updateGovernanceDelegation = async () => {
    if (!activeCommunity) return;
    const requested = window.prompt("投票を委任するメンバー名を入力してください。空欄で解除します。", governanceDelegateName)?.trim() ?? "";
    const delegate = requested ? members.find((member) => member.displayName.toLocaleLowerCase("ja") === requested.toLocaleLowerCase("ja")) : undefined;
    if (requested && !delegate) { setError("該当するメンバーが見つかりません。"); return; }
    const response = await fetch(`/api/communities/${activeCommunity.id}/governance/delegation`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delegateProfileId: delegate?.id ?? null }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(payload.error ?? "投票の委任を更新できませんでした。"); return; }
    setGovernanceDelegateName(delegate?.displayName ?? "");
  };

  const saveGovernanceSettings = (settings: CommunityGovernanceSettings) => {
    if (!activeCommunity) return;
    setGovernanceSettingsByCommunity(current => new Map(current).set(activeCommunity.id, settings));
  };

  const savedGovernanceProposal = (proposal: CommunityGovernanceProposal, memberCount: number) => {
    if (!activeCommunity || !currentMember || proposal.communityId !== activeCommunity.id || proposal.authorProfileId !== currentMember.id) return;
    setGovernanceByCommunity(current => {
      const rows = current.get(activeCommunity.id) ?? [], existing = rows.find(row => row.id === proposal.id);
      if (!existing && proposal.status !== "discussion") return current;
      const updated: CommunityGovernanceProposalView = { ...existing, ...proposal, authorName: currentMember.displayName, linkedGuideProposalTitle: activeGuideProposals.find(row => row.id === proposal.linkedGuideProposalId)?.title ?? null, eligibleMemberCount: existing?.eligibleMemberCount ?? memberCount, tally: existing?.tally ?? { for: 0, against: 0, abstain: 0, voters: 0 }, viewerVote: existing?.viewerVote ?? null };
      return new Map(current).set(activeCommunity.id, existing ? rows.map(row => row.id === proposal.id ? updated : row) : [updated, ...rows]);
    });
    router.refresh();
  };
  const changedGovernanceProposal = (result: CommunityGovernanceMutationResult) => {
    if (!activeCommunity || result.proposal.communityId !== activeCommunity.id) return;
    const { proposal, tally, myVote, votes, eligibleMembers, eligibilityKnown } = result;
    const topTenWeightShare = votes
      ? (tally.total.weight > 0 ? Math.round([...votes].sort((a, b) => b.weight - a.weight).slice(0, 10).reduce((sum, vote) => sum + vote.weight, 0) / tally.total.weight * 100) : 0)
      : undefined;
    setGovernanceByCommunity(current => new Map(current).set(activeCommunity.id,
      (current.get(activeCommunity.id) ?? []).map(entry => entry.id === proposal.id ? {
        ...entry, ...proposal, eligibleMemberCount: eligibleMembers, eligibilityKnown, viewerVote: myVote?.choice ?? null,
        tally: { for: tally.for.weight, against: tally.against.weight, abstain: tally.abstain.weight, voters: tally.total.count,
          memberFor: tally.for.memberWeight, memberAgainst: tally.against.memberWeight,
          tokenFor: tally.for.tokenWeight, tokenAgainst: tally.against.tokenWeight,
          participatingTokenWeight: tally.total.tokenWeight, topTenWeightShare },
      } : entry)));
  };

  /* An explicit choice wins; otherwise the guides view opens it, because its
     proposals and index panels live nowhere else. */
  const sidePanelOpen = sidePanelChoice ?? workspaceView === "guides";

  /*
   * Below 1600px the workspace stacks, and the panel lands beneath the room
   * list and the conversation — measured at 1341px down on a 1400px viewport.
   * Opening it there changed nothing anyone could see, which is the same lie
   * the hidden column told, only quieter. Only on a deliberate open: the
   * guides view brings it up by default and must not yank the page.
   */
  useEffect(() => {
    if (sidePanelChoice !== true) return;
    const panel = sidePanelRef.current;
    if (!panel) return;
    const { top } = panel.getBoundingClientRect();
    if (top >= 0 && top < window.innerHeight) return;
    /* Default behaviour, not "smooth": the animated form advances only while
       the page composites frames, so it could not be verified, and moving the
       minimum distance at once is what someone who pressed a button expects
       anyway. */
    panel.scrollIntoView({ block: "nearest" });
  }, [sidePanelChoice]);

  return (
    <section
      className={
        [
          "community-workspace community-workspace--channels tab-left-column-layout",
          sidePanelOpen ? "community-workspace--side-panel" : "",
          embedded ? "community-workspace--embedded" : "",
        ].filter(Boolean).join(" ")
      }
      aria-label="Hubコミュニティ"
    >
      {!embedded && <aside
        data-hub-page-left-column
        className="community-room-list tab-left-column"
        aria-label={
          activeCommunity ? `${activeCommunity.name}のチャンネル` : "チャンネル"
        }
      >
        {activeCommunity ? (
          <>
            <header>
              <span>
                <strong>{activeCommunity.name}</strong>
                <small>{activeCommunity.category}</small>
              </span>
              <span className="community-room-list__controls">
                {/*
                  * Here rather than in the conversation header, which only
                  * renders in the feed view with a channel chosen. The panel
                  * carries moderation and the guides proposals, and neither
                  * belongs to a single view.
                  */}
                <button
                  type="button"
                  className={
                    sidePanelOpen
                      ? "community-side-panel-toggle community-side-panel-toggle--active"
                      : "community-side-panel-toggle"
                  }
                  aria-label="メンバーと管理"
                  title="メンバーと管理"
                  aria-expanded={sidePanelOpen}
                  onClick={() => setSidePanelChoice(!sidePanelOpen)}
                >
                  {/*
                    * 210pxの中左列では、この行の181pxを名前と操作群で分け合う。
                    * 「メンバー」の4文字が入ると操作群が129pxを取り、コミュニティ名が
                    * 44pxまで潰れて読めなくなる（必要111px）。行の高さは
                    * column-title-system.css が固定しているので折り返しでは直らない。
                    * 語は隠して数だけ残す。用は aria-label と title が果たす。
                  */}
                  <span className="community-side-panel-toggle__label">メンバー</span>
                  {" "}
                  {members.length}
                </button>
                {/*
                  * 通知設定と「すべて既読」はこの行に置かない。
                  *
                  * 210pxの中左列では、見出し行の181pxを名前と操作群で分け合う。
                  * 操作が8つ並んでいたときの自然幅の合計は289pxで、コミュニティ名は
                  * 48px——日本語で3字——まで潰れていた（必要111px）。行の高さは
                  * column-title-system.css が固定しているので折り返しでは直らない。
                  * 名前が読めないほうが、操作が1手増えることより悪い。
                  * どちらも破壊的でないので ••• の中で足りる。
                  */}
                {(joined || channelUnreadCount > 0 || isOwner || canManageChannels) && (
                  <details className="community-management-menu">
                    <summary aria-label="コミュニティのその他の操作">•••</summary>
                    <div>
                      {joined && (
                        <button type="button" aria-label="コミュニティ通知設定" onClick={openCommunityNotifications}>通知設定</button>
                      )}
                      {channelUnreadCount > 0 && (
                        <button type="button" aria-label="すべてのチャンネルを既読にする" onClick={() => void markAllCommunityChannelsRead()}>すべて既読にする</button>
                      )}
                      {isOwner && (
                        <button type="button" aria-label="コミュニティ設定" onClick={openCommunityEditor}>コミュニティ設定</button>
                      )}
                      {canManageChannels && (
                        <button type="button" aria-label="コミュニティ運営センター" onClick={() => setShowCommunityOperations(true)}>運営センター</button>
                      )}
                      {canManageChannels && (
                        <button type="button" aria-label="ゲーム攻略の設定" onClick={() => setShowGameManager(true)}>ゲーム攻略の設定</button>
                      )}
                      {joined && (
                        <button type="button" onClick={() => void reportDuplicateCommunity()}>重複を報告</button>
                      )}
                      {joined && (
                        <button type="button" onClick={() => void submitCommunityAppeal()}>処分へ異議申立て</button>
                      )}
                    </div>
                  </details>
                )}
                {activeCommunity.viewerRole === "owner" ? (
                  <span
                    className="community-owner-status"
                    aria-label="コミュニティ管理者"
                    title="コミュニティ管理者"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3.2 19 6v5.2c0 4.4-2.8 7.8-7 9.6-4.2-1.8-7-5.2-7-9.6V6l7-2.8Z" />
                      <path d="m8.8 12 2 2 4.5-4.5" />
                    </svg>
                    <span>管理者</span>
                  </span>
                ) : !authenticated ? (
                  <a
                    className="community-membership"
                    href={`/auth?next=${encodeURIComponent(
                      `/community?community=${activeCommunity.slug}`,
                    )}`}
                  >
                    ログインして参加
                  </a>
                ) : (
                  <button
                    type="button"
                    className={
                      joined
                        ? "community-membership community-membership--joined"
                        : "community-membership"
                    }
                    onClick={toggleMembership}
                    disabled={isPending}
                  >
                    {joined ? "参加中" : pendingMembershipRequest ? "申請中" : "参加"}
                  </button>
                )}
              </span>
            </header>
            {membershipReceipt ? <p role="status">{membershipReceipt}</p> : null}
            {joinCommunityId === activeCommunity.id && <CommunityJoinControls communityId={activeCommunity.id} actorId={authenticated ? currentMember?.id : ""} memory={joinMemory.current} onChanged={state => {
              setJoinedById(current => new Map(current).set(activeCommunity.id, state.joined));
              setPendingMembershipRequestById(current => new Map(current).set(activeCommunity.id, state.pending));
              router.refresh();
            }}/>}
            <p>{activeCommunity.description}</p>
            <nav>
              <div
                className="community-room-entry community-room-entry--home"
                data-room-kind="home"
              >
                <button
                  type="button"
                  title="コミュニティホーム"
                  className={
                    workspaceView === "home" ? "community-room--active" : ""
                  }
                  aria-current={workspaceView === "home" ? "page" : undefined}
                  onClick={() => setWorkspaceView("home")}
                >
                  <span
                    className="community-room-home-icon"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M3.5 10.5 12 3.6l8.5 6.9" />
                      <path d="M5.5 9.3v11.1h13V9.3" />
                      <path d="M9.4 20.4v-6.2h5.2v6.2" />
                    </svg>
                  </span>
                  <span>
                    <strong>ホーム</strong>
                    <small>概要・新着・人気チャンネル</small>
                  </span>
                </button>
              </div>
              {(activeTokens.length > 0 ||
                activeCommunity.governanceMode === "dao") && (
                <>
                  <div className="community-room-list__subheading community-room-list__subheading--features">
                    <button
                      type="button"
                      className="community-room-category-toggle"
                      aria-expanded={roomCategoryIsOpen("features")}
                      onClick={() => toggleRoomCategory("features")}
                    >
                      <span>
                        <strong>コミュニティ機能</strong>
                        <small>トークン・運営</small>
                      </span>
                      <span className="community-room-category-chevron" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" /></svg></span>
                    </button>
                  </div>
                  {roomCategoryIsOpen("features") && activeTokens.length > 0 && (
                    <div
                      className="community-room-entry community-room-entry--tokens"
                      data-room-kind="tokens"
                    >
                      <button
                        type="button"
                        title="コミュニティトークン"
                        className={
                          workspaceView === "tokens"
                            ? "community-room--active"
                            : ""
                        }
                        aria-current={
                          workspaceView === "tokens" ? "page" : undefined
                        }
                        onClick={() => setWorkspaceView("tokens")}
                      >
                        <span
                          className="community-room-token-icon"
                          aria-hidden="true"
                        >
                          <i />
                        </span>
                        <span>
                          <strong>トークン</strong>
                          <small>{activeTokens.length}種類登録済み</small>
                        </span>
                      </button>
                    </div>
                  )}
                  {roomCategoryIsOpen("features") && activeCommunity.governanceMode === "dao" && (
                    <div
                      className="community-room-entry community-room-entry--governance"
                      data-room-kind="governance"
                    >
                      <button
                        type="button"
                        title="コミュニティ運営の提案と投票"
                        className={
                          workspaceView === "governance"
                            ? "community-room--active"
                            : ""
                        }
                        aria-current={
                          workspaceView === "governance" ? "page" : undefined
                        }
                        onClick={() => setWorkspaceView("governance")}
                      >
                        <span
                          className="community-room-governance-icon"
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 20 20" focusable="false">
                            <path d="M5 5 10 10 15 5M10 10v5" />
                            <circle cx="5" cy="5" r="2" />
                            <circle cx="15" cy="5" r="2" />
                            <circle cx="10" cy="15" r="2" />
                            <circle
                              className="community-room-governance-icon__hub"
                              cx="10"
                              cy="10"
                              r="1.35"
                            />
                          </svg>
                        </span>
                        <span>
                          <strong>ガバナンス</strong>
                          <small>提案・議論・投票</small>
                        </span>
                        {activeGovernanceProposals.filter(
                          (proposal) => proposal.status === "voting",
                        ).length > 0 && (
                          <em aria-label="投票中のDAO提案">
                            {
                              activeGovernanceProposals.filter(
                                (proposal) => proposal.status === "voting",
                              ).length
                            }
                          </em>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
              <div
                className="community-room-entry community-room-entry--posts"
                data-room-kind="posts"
              >
                <button
                  type="button"
                  title="コミュニティ全体の投稿"
                  className={
                    workspaceView === "posts" ? "community-room--active" : ""
                  }
                  aria-current={workspaceView === "posts" ? "page" : undefined}
                  onClick={() => setWorkspaceView("posts")}
                >
                  <span className="community-room-posts-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M5 5.5h14v10H9l-4 3v-13Z" />
                      <path d="M8.5 9h7M8.5 12h5" />
                    </svg>
                  </span>
                  <span>
                    <strong>投稿</strong>
                    <small>人気・新着・質問・議論</small>
                  </span>
                  {communityMessages.length > 0 && (
                    <em aria-label={`${communityMessages.length}件の投稿`}>
                      {communityMessages.length > 99 ? "99+" : communityMessages.length}
                    </em>
                  )}
                </button>
              </div>
              <div className="community-room-list__heading">
                <button
                  type="button"
                  className="community-room-category-toggle"
                  aria-expanded={roomCategoryIsOpen("channels")}
                  onClick={() => toggleRoomCategory("channels")}
                >
                  <span>
                    <strong>チャンネル</strong>
                    <small>投稿・質問・募集</small>
                  </span>
                  {!roomCategoryIsOpen("channels") && channelUnreadCount > 0 && (
                    <em aria-label={`${channelUnreadCount}件の未読`}>
                      {channelUnreadCount > 99 ? "99+" : channelUnreadCount}
                    </em>
                  )}
                  <span className="community-room-category-chevron" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" /></svg></span>
                </button>
                {canManageChannels && (
                  <button
                    type="button"
                    className="community-room-category-add"
                    aria-label="チャンネルを作成"
                    onClick={() => {
                      setEditingChannelId(null);
                      setChannelName("");
                      setChannelDescription("");
                      setError("");
                      setShowCreateChannel(true);
                    }}
                  >
                    ＋
                  </button>
                )}
              </div>
              {roomCategoryIsOpen("channels") && activeChannels.map((channel, index) => (
                <div
                  className="community-room-entry"
                  data-room-kind="channel"
                  key={channel.id}
                >
                  <button
                    type="button"
                    title={`${channel.name} — ${channel.description}`}
                    className={
                      workspaceView === "feed" &&
                      channel.id === activeChannel?.id
                        ? "community-room--active"
                        : ""
                    }
                    aria-current={
                      workspaceView === "feed" &&
                      channel.id === activeChannel?.id
                        ? "page"
                        : undefined
                    }
                    onClick={() => {
                      openCommunityChannel(channel.id);
                    }}
                  >
                    <span aria-hidden="true">#</span>
                    <span>
                      <strong>{channel.name}</strong>
                      <small>{channel.description}</small>
                    </span>
                    {channel.unreadCount > 0 && (
                      <em aria-label={`${channel.unreadCount}件の未読`}>
                        {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                      </em>
                    )}
                  </button>
                  {canManageChannels && (
                    <details className="community-management-menu community-room-entry__actions">
                      <summary aria-label={`${channel.name}の管理メニュー`}>
                        •••
                      </summary>
                      <div>
                        <button
                          type="button"
                          aria-label={`${channel.name}を編集`}
                          onClick={() => openChannelEditor(channel)}
                        >
                          チャンネルを編集
                        </button>
                        <button
                          type="button"
                          aria-label={`${channel.name}を上へ移動`}
                          onClick={() => moveChannel(channel.id, "up")}
                          disabled={index === 0}
                        >
                          上へ移動
                        </button>
                        <button
                          type="button"
                          aria-label={`${channel.name}を下へ移動`}
                          onClick={() => moveChannel(channel.id, "down")}
                          disabled={index === activeChannels.length - 1}
                        >
                          下へ移動
                        </button>
                        <button
                          type="button"
                          className="community-management-menu__danger"
                          aria-label={`${channel.name}を削除`}
                          onClick={() => setPendingChannelDelete({ id: channel.id, name: channel.name, messageCount: channel.messages.length })}
                          disabled={activeChannels.length <= 1}
                        >
                          チャンネルを削除
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              ))}
              {activeGuides.length > 0 && (
                <>
                  <div className="community-room-list__subheading community-room-list__subheading--guides">
                    <button
                      type="button"
                      className="community-room-category-toggle"
                      aria-expanded={roomCategoryIsOpen("guides")}
                      onClick={() => toggleRoomCategory("guides")}
                    >
                      <span>
                        <strong>{knowledgeLabel}</strong>
                        <small title={knowledgeDescription}>
                          {knowledgeDescription}
                        </small>
                      </span>
                      <span className="community-room-category-chevron" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" /></svg></span>
                    </button>
                    <button
                      type="button"
                      className="community-room-category-add"
                      aria-label={`${knowledgeLabel}ページを提案`}
                      title={knowledgeDescription}
                      onClick={() => openGuideProposalEditor()}
                      disabled={!canPost}
                    >
                      ＋
                    </button>
                  </div>
                  {roomCategoryIsOpen("guides") && activeGuides
                    .filter((guide) => !guide.directoryId)
                    .map((guide) => (
                      <div
                        className="community-room-entry community-room-entry--guide-page"
                        data-room-kind="guide"
                        key={guide.id}
                      >
                        <button
                          type="button"
                          className={
                            workspaceView === "guides" &&
                            activeGuide?.id === guide.id &&
                            !selectedGuideProposal
                              ? "community-room--active"
                              : ""
                          }
                          onClick={() => {
                            setActiveGuideId(guide.id);
                            setSelectedGuideProposalId(null);
                            setWorkspaceView("guides");
                          }}
                        >
                          <span aria-hidden="true">▤</span>
                          <span>
                            <strong>{guide.title}</strong>
                            <small>v{guide.version}</small>
                          </span>
                        </button>
                      </div>
                    ))}
                  {roomCategoryIsOpen("guides") && activeGuideDirectories.map((directory) => (
                    <div
                      className="community-room-guide-directory"
                      key={directory.id}
                      style={
                        {
                          "--guide-directory-depth": guideDirectoryDepth(
                            directory,
                            activeGuideDirectories,
                          ),
                        } as CSSProperties
                      }
                    >
                      <div className="community-room-guide-directory__name">
                        <span aria-hidden="true">▾</span>
                        <strong>{directory.name}</strong>
                      </div>
                      {activeGuides
                        .filter((guide) => guide.directoryId === directory.id)
                        .map((guide) => (
                          <div
                            className="community-room-entry community-room-entry--guide-page"
                            data-room-kind="guide"
                            key={guide.id}
                          >
                            <button
                              type="button"
                              className={
                                workspaceView === "guides" &&
                                activeGuide?.id === guide.id &&
                                !selectedGuideProposal
                                  ? "community-room--active"
                                  : ""
                              }
                              onClick={() => {
                                setActiveGuideId(guide.id);
                                setSelectedGuideProposalId(null);
                                setWorkspaceView("guides");
                              }}
                            >
                              <span aria-hidden="true">└</span>
                              <span>
                                <strong>{guide.title}</strong>
                                <small>v{guide.version}</small>
                              </span>
                            </button>
                          </div>
                        ))}
                    </div>
                  ))}
                  {roomCategoryIsOpen("guides") && activeGuideProposals.length > 0 && (
                    <div className="community-room-guide-proposals">
                      <div className="community-room-guide-directory__name">
                        <span aria-hidden="true">↗</span>
                        <strong>編集提案</strong>
                      </div>
                      {activeGuideProposals.map((proposal) => (
                        <div
                          className="community-room-entry community-room-entry--guide-proposal"
                          data-room-kind="guide-proposal"
                          key={proposal.id}
                        >
                          <button
                            type="button"
                            className={
                              workspaceView === "guides" &&
                              selectedGuideProposal?.id === proposal.id
                                ? "community-room--active"
                                : ""
                            }
                            onClick={() => {
                              setSelectedGuideProposalId(proposal.id);
                              setWorkspaceView("guides");
                            }}
                          >
                            <span aria-hidden="true">案</span>
                            <span>
                              <strong>{proposal.title}</strong>
                              <small>
                                {proposal.status === "open"
                                  ? "レビュー中"
                                  : proposal.status === "changes_requested"
                                    ? "修正依頼"
                                    : proposal.status === "merged"
                                      ? "マージ済み"
                                      : "終了"}
                              </small>
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </nav>
          </>
        ) : (
          <p>コミュニティはまだありません。</p>
        )}
      </aside>}

      <section className="community-chat" hidden={embedded === "members" || embedded === "settings"}>
        {activeCommunity && (
          <section
            className="community-portal"
            aria-label={`${activeCommunity.name}のホーム`}
            /* 埋め込みでメンバー・設定を開いたときは、ホームの会話を後ろに出さない。 */
            hidden={workspaceView !== "home" || embedded === "members" || embedded === "settings"}
          >
            <header className="community-portal__hero">
              <div className="community-portal__identity">
                <span className="community-portal__image">
                  {communityImagesById.get(activeCommunity.id) ? (
                    <img
                      src={communityImagesById.get(activeCommunity.id)}
                      alt=""
                      width={64}
                      height={64}
                      decoding="async"
                    />
                  ) : (
                    initials(activeCommunity.name).slice(0, 1)
                  )}
                </span>
                <div>
                  <small>{activeCommunity.category}</small>
                  <h2>{activeCommunity.name}</h2>
                  <p>{activeCommunity.description}</p>
                </div>
              </div>
              <div className="community-portal__hero-side">
                <div className="community-portal__actions">
                  <button
                    type="button"
                    onClick={() => setWorkspaceView("feed")}
                  >
                    チャンネルを見る
                  </button>
                  {activeGuide && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveGuideId(activeGuide.id);
                        setSelectedGuideProposalId(null);
                        setWorkspaceView("guides");
                      }}
                    >
                      {knowledgeLabel}を読む
                    </button>
                  )}
                </div>
              </div>
            </header>

            <section className="community-portal__start">
              <header>
                <div>
                  <small>はじめに</small>
                  <h2>まず見る</h2>
                </div>
                <p>初めてでも迷わない入口</p>
              </header>
              <div className="community-portal__start-grid">
                {activeChannels.slice(0, 3).map((channel, index) => (
                  <button
                    type="button"
                    key={channel.id}
                    onClick={() => {
                      setActiveChannelId(channel.id);
                      setWorkspaceView("feed");
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>
                        {index === 0
                          ? "はじめに"
                          : index === 1
                            ? "最新情報"
                            : "質問・交流"}
                      </small>
                      <strong>{channel.name}</strong>
                      <p>{channel.description}</p>
                    </div>
                    <i aria-hidden="true">→</i>
                  </button>
                ))}
              </div>
            </section>

            <div className={popularChannels.some((channel) => channel.messages.length > 0) || activeGuide || activeTokens.length > 0 ? "community-portal__columns" : "community-portal__columns community-portal__columns--single"}>
              <section className="community-portal__updates">
                <header>
                  <div>
                    <small>新着</small>
                    <h2>新着の投稿</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceView("feed")}
                  >
                    すべて見る
                  </button>
                </header>
                <div>
                  {communityMessages.slice(0, 5).map((message) => (
                    <button
                      type="button"
                      key={`${message.channelId}:${message.id}`}
                      onClick={() => {
                        setActiveChannelId(message.channelId);
                        setWorkspaceView("feed");
                      }}
                    >
                      <Avatar
                        name={message.displayName}
                        url={message.avatarUrl}
                        small
                      />
                      <span>
                        <small>
                          #{message.channelName} ·{" "}
                          {formatTime(message.createdAt)}
                        </small>
                        <strong>{message.displayName}</strong>
                        <p>{message.body}</p>
                      </span>
                    </button>
                  ))}
                  {communityMessages.length === 0 && activeChannels[0] && (
                    <button
                      type="button"
                      className="community-portal__empty-action"
                      onClick={() => {
                        setActiveChannelId(activeChannels[0].id);
                        setWorkspaceView("feed");
                      }}
                    >
                      <strong>最初の投稿を作る</strong>
                      <span>#{activeChannels[0].name} を開く</span>
                    </button>
                  )}
                </div>
              </section>

              {(popularChannels.some((channel) => channel.messages.length > 0) || activeGuide || activeTokens.length > 0) && <aside className="community-portal__popular">
                <header>
                  <small>案内</small>
                  <h2>コミュニティ情報</h2>
                </header>
                <ol>
                  {popularChannels.filter((channel) => channel.messages.length > 0).map((channel, index) => (
                    <li key={channel.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChannelId(channel.id);
                          setWorkspaceView("feed");
                        }}
                      >
                        <span>{index + 1}</span>
                        <div>
                          <strong>{channel.name}</strong>
                          <small>{channel.description}</small>
                        </div>
                        <em>{channel.messages.length}件</em>
                      </button>
                    </li>
                  ))}
                </ol>
                {activeGuide && (
                  <button
                    type="button"
                    className="community-portal__knowledge"
                    onClick={() => {
                      setActiveGuideId(activeGuide.id);
                      setSelectedGuideProposalId(null);
                      setWorkspaceView("guides");
                    }}
                  >
                    <span aria-hidden="true">⌑</span>
                    <div>
                      <small>{knowledgeLabel}</small>
                      <strong>{activeGuide.title}</strong>
                      <p>
                        {activeGuides.length}ページ · 編集提案
                        {openGuideProposalCount}件
                      </p>
                    </div>
                    <i aria-hidden="true">→</i>
                  </button>
                )}
                {activeTokens.length > 0 && (
                  <button
                    type="button"
                    className="community-portal__token"
                    onClick={() => setWorkspaceView("tokens")}
                  >
                    <span>
                      <small>ON-CHAIN</small>
                      <strong>
                        {activeTokens[0]?.symbol} コミュニティトークン
                      </strong>
                    </span>
                    <i aria-hidden="true">→</i>
                  </button>
                )}
              </aside>}
            </div>
          </section>
        )}
        {activeCommunity && activeTokens.length > 0 && (
          <section
            className="community-token-hub"
            hidden={workspaceView !== "tokens"}
            aria-label={`${activeCommunity.name}のトークン`}
          >
            <header className="community-token-hub__header">
              <div>
                <small>COMMUNITY TOKEN</small>
                <h2>トークン</h2>
                <p>
                  コミュニティに登録されたトークンの保有状況とDAO投票点を確認できます。
                </p>
              </div>
              <a href={hubSurfacePath(surface, "/token")}>全体ランキングを見る</a>
            </header>

            <nav
              className="community-token-hub__tabs"
              aria-label="登録トークン"
            >
              {activeTokens.map((token) => (
                <button
                  type="button"
                  key={token.id}
                  className={
                    token.id === activeToken?.id
                      ? "community-token-hub__tab--active"
                      : ""
                  }
                  aria-pressed={token.id === activeToken?.id}
                  onClick={() => setActiveTokenId(token.id)}
                >
                  <strong>{token.symbol}</strong>
                  <small>{token.network}</small>
                </button>
              ))}
            </nav>

            {activeToken && (
              <div className="community-token-hub__body">
                <section className="community-token-hub__summary">
                  <header>
                    <span>
                      <small>{activeToken.network}</small>
                      <h2>{activeToken.name}</h2>
                      <strong>{activeToken.symbol}</strong>
                    </span>
                    <em
                      className={
                        activeToken.verifiedAt
                          ? "community-token-hub__verified"
                          : ""
                      }
                    >
                      {activeToken.verifiedAt ? "検証済み" : "未検証"}
                    </em>
                  </header>
                  <dl>
                    <div>
                      <dt>あなたの保有量</dt>
                      <dd>
                        {formatAmount(activeToken.viewerAmount)}{" "}
                        {activeToken.symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>総保有量</dt>
                      <dd>
                        {formatAmount(activeToken.totalAmount)}{" "}
                        {activeToken.symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>保有者</dt>
                      <dd>{activeToken.holderCount}人</dd>
                    </div>
                    <div>
                      <dt>このトークンの投票点</dt>
                      <dd>{activeTokenRule ? `${activeTokenVotePoints}点` : "未使用"}</dd>
                    </div>
                  </dl>
                  {activeTokenRule && (
                    <p>
                      {activeTokenRule.tokensPerVote} {activeToken.symbol} ={" "}
                      {activeTokenRule.weight}点
                    </p>
                  )}
                </section>

                <section className="community-token-hub__voting">
                  <small>DAO VOTING POWER</small>
                  <strong>{combinedViewerVotePoints}点</strong>
                  <p>
                    現在の投票設定と表示中の保有量から算出した参考値です。実際の投票時にはサーバーで再検証されます。
                  </p>
                </section>

                <section className="community-token-hub__ranking">
                  <header>
                    <span>
                      <small>HOLDERS</small>
                      <h2>保有者ランキング</h2>
                    </span>
                    <strong>{activeToken.holderCount}人</strong>
                  </header>
                  <ol aria-label={`${activeToken.symbol}保有量ランキング`}>
                    {activeToken.holders.map((holding, index) => (
                      <li key={holding.profileId}>
                        <span>
                          <em>{index + 1}</em>
                          <strong>
                            {memberMap.get(holding.profileId)?.displayName ??
                              "Unknown"}
                          </strong>
                        </span>
                        <b>
                          {formatAmount(holding.amount)} {activeToken.symbol}
                        </b>
                      </li>
                    ))}
                  </ol>
                  {!activeToken.holders.length && (
                    <p>検証済みの保有者データはまだありません。</p>
                  )}
                </section>
              </div>
            )}
          </section>
        )}
        {activeCommunity?.governanceMode === "dao" && (
          <section
            className="community-governance"
            hidden={workspaceView !== "governance"}
            aria-label={`${activeCommunity.name}のDAOガバナンス`}
          >
            <header className="community-governance__header">
              <div>
                <small>COMMUNITY DAO</small>
                <h2>ガバナンス</h2>
                <p>
                  資金を扱わず、共同ページ・チャンネル・ルール・運営体制をメンバー投票で決定します。
                </p>
              </div>
              <span className="community-governance__header-actions">
                <button type="button" onClick={() => void updateGovernanceDelegation()} disabled={!joined}>
                  {governanceDelegateName ? `委任中：${governanceDelegateName}` : "投票を委任"}
                </button>
                {isOwner && (
                  <button type="button" onClick={openGovernanceSettings}>
                    投票設定
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setShowGovernanceEditor((current) => !current);
                  }}
                  disabled={!canPost}
                >
                  ＋ 新しい提案
                </button>
              </span>
            </header>

            <div className="community-governance__policy">
              <span>
                <small>投票方式</small>
                <strong>
                  {activeGovernanceSettings?.votingStrategy === "token_weighted"
                    ? "トークン保有量比例"
                    : activeGovernanceSettings?.votingStrategy ===
                        "token_capped"
                      ? "トークン比例＋上限"
                      : "1メンバー1票"}
                </strong>
              </span>
              <span>
                <small>票数の計算</small>
                <strong>
                  {activeGovernanceSettings?.votingStrategy ===
                  "one_member_one_vote"
                    ? "1人につき1票"
                    : `${activeGovernanceSettings?.tokenRules.length ?? 0}種類のトークン点を合算`}
                </strong>
              </span>
              <span>
                <small>1人あたりの上限</small>
                <strong>
                  {activeGovernanceSettings?.votingStrategy === "token_capped"
                    ? `${activeGovernanceSettings.voteWeightCap ?? 100}票`
                    : "上限なし"}
                </strong>
              </span>
            </div>

            {showGovernanceSettings && activeCommunity && <CommunityGovernanceSettingsControls communityId={activeCommunity.id} actorId={currentMember?.id} memory={governanceSettingsMemory.current} onSaved={saveGovernanceSettings} onClose={() => setShowGovernanceSettings(false)}/>}

            {showGovernanceEditor && activeCommunity && <CommunityGovernanceCreateControls communityId={activeCommunity.id} communityName={activeCommunity.name} actorId={currentMember?.id} guideProposals={activeGuideProposals} memory={governanceCreateMemory.current} onCreated={savedGovernanceProposal} onClose={() => setShowGovernanceEditor(false)}/>}
            <div className="community-governance-list">
              {activeGovernanceProposals.map((proposal) => {
                const decisiveVotes =
                  proposal.tally.for + proposal.tally.against;
                const approvalRate =
                  decisiveVotes > 0
                    ? Math.round((proposal.tally.for / decisiveVotes) * 100)
                    : 0;
                const turnoutRate = proposal.eligibilityKnown
                  ? (proposal.eligibleMemberCount > 0 ? Math.round(proposal.tally.voters / proposal.eligibleMemberCount * 100) : 0)
                  : null;
                return (
                  <article
                    className="community-governance-proposal"
                    key={proposal.id}
                  >
                    <header>
                      <span>
                        <small>
                          {proposal.kind === "guide"
                            ? "ページ編集"
                            : proposal.kind === "channel"
                              ? "チャンネル"
                              : proposal.kind === "rule"
                                ? "ルール"
                                : "モデレーター"}
                        </small>
                        <strong>{proposal.title}</strong>
                      </span>
                      <em
                        className={`community-governance-status community-governance-status--${proposal.status}`}
                      >
                        {proposal.status === "voting"
                          ? "投票中"
                          : proposal.status === "passed"
                            ? "可決"
                            : proposal.status === "rejected"
                              ? "否決"
                              : proposal.status === "executed"
                                ? "実行済み"
                                : proposal.status === "discussion"
                                  ? "議論中"
                                  : "終了"}
                      </em>
                    </header>
                    <p>{proposal.body}</p>
                    <div className="community-governance-proposal__strategy">
                      <span>
                        {({
                          one_member_one_vote: "1メンバー1票",
                          one_holder_one_vote: "保有者1人1票",
                          token_linear: "トークン保有量比例",
                          token_sqrt: "トークン平方根加重",
                          token_log: "トークン対数加重",
                          dual_chamber: "複合投票（メンバー＋トークン）",
                        } as const)[proposal.votingMethod ?? (proposal.votingStrategy === "one_member_one_vote" ? "one_member_one_vote" : "token_linear")]}
                        {proposal.votingMethod && proposal.votingMethod !== "one_member_one_vote"
                          ? ` ・ ${(proposal.governanceTokenRules ?? [
                              {
                                tokenId: proposal.governanceTokenId ?? "",
                                tokenSymbol:
                                  proposal.governanceTokenSymbol ?? "TOKEN",
                                tokensPerVote: proposal.tokensPerVote,
                                weight: 1,
                              },
                            ])
                              .map(
                                (rule) =>
                                  `${rule.tokensPerVote} ${rule.tokenSymbol ?? "TOKEN"} = ${rule.weight}点`,
                              )
                              .join(" ＋ ")}`
                          : ""}
                      </span>
                      {proposal.votingStrategy === "token_capped" && (
                        <span>最大{proposal.voteWeightCap ?? 100}票</span>
                      )}
                      <span>設定は提案作成時に固定</span>
                      <span>
                        {proposal.executionMode === "advisory"
                          ? "意向調査・拘束力なし"
                          : proposal.executionMode === "timelock"
                            ? "可決後タイムロック"
                            : proposal.executionMode === "veto"
                              ? "重大事故時の停止権あり"
                              : "可決後に運営が実行"}
                      </span>
                      <span>
                        {proposal.snapshotCapturedAt
                          ? `残高固定 ${formatTime(proposal.snapshotCapturedAt)}`
                          : "投票開始時に残高を固定"}
                      </span>
                    </div>
                    {proposal.linkedGuideProposalTitle && (
                      <button
                        className="community-governance-proposal__guide"
                        type="button"
                        onClick={() => {
                          setSelectedGuideProposalId(
                            proposal.linkedGuideProposalId ?? null,
                          );
                          setWorkspaceView("guides");
                        }}
                      >
                        編集提案：{proposal.linkedGuideProposalTitle} →
                      </button>
                    )}
                    <div className="community-governance-metrics">
                      <span>
                        <small>賛成率</small>
                        <strong>{approvalRate}%</strong>
                        <i>
                          <b style={{ width: `${approvalRate}%` }} />
                        </i>
                      </span>
                      <span>
                        <small>投票率</small>
                        <strong>{turnoutRate === null ? "資格者を未確認" : `${turnoutRate}%`}</strong>
                        <i>
                          <b style={{ width: `${turnoutRate ?? 0}%` }} />
                        </i>
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>賛成</dt>
                        <dd>{proposal.tally.for}</dd>
                      </div>
                      <div>
                        <dt>反対</dt>
                        <dd>{proposal.tally.against}</dd>
                      </div>
                      <div>
                        <dt>棄権</dt>
                        <dd>{proposal.tally.abstain}</dd>
                      </div>
                      <div>
                        <dt>定足数</dt>
                        <dd>
                          {proposal.tally.voters}/{proposal.quorum}
                        </dd>
                      </div>
                      {proposal.votingMethod === "dual_chamber" && (
                        <>
                          <div><dt>メンバー票</dt><dd>{proposal.tally.memberFor ?? 0} / {proposal.tally.memberAgainst ?? 0}</dd></div>
                          <div><dt>トークン票</dt><dd>{proposal.tally.tokenFor ?? 0} / {proposal.tally.tokenAgainst ?? 0}</dd></div>
                        </>
                      )}
                      {proposal.votingMethod !== "one_member_one_vote" && (
                        <>
                          <div><dt>参加トークン点</dt><dd>{proposal.tally.participatingTokenWeight ?? 0}</dd></div>
                          <div><dt>上位10名の比率</dt><dd>{proposal.tally.topTenWeightShare === undefined ? "票の詳細を未取得" : `${proposal.tally.topTenWeightShare}%`}</dd></div>
                        </>
                      )}
                    </dl>
                    <footer>
                      <small>
                        提案者 {proposal.authorName}
                        {proposal.status === "voting"
                          ? ` ・ 締切 ${formatTime(proposal.votingEndsAt)}`
                          : proposal.status === "discussion"
                            ? " ・ 意見募集中"
                            : ` ・ 更新 ${formatTime(proposal.updatedAt)}`}
                      </small>
                      <CommunityGovernanceMutationControls communityId={activeCommunity.id} proposalId={proposal.id} actorId={currentMember?.id} memory={governanceMutationMemory} onChanged={changedGovernanceProposal}/>

                    </footer>
                  </article>
                );
              })}
              {activeGovernanceProposals.length === 0 && (
                <p className="community-governance-empty">
                  DAO提案はまだありません。
                </p>
              )}
            </div>
          </section>
        )}
        {activeGuides.length > 0 && (
          <section
            className="community-guide-site"
            data-workspace-kind="guide"
            hidden={workspaceView !== "guides"}
            aria-label={`${activeCommunity.name}の${knowledgeLabel}`}
          >
            {false && (
              <aside className="community-guide-site__nav">
                <header>
                  <span>
                    <small>COMMUNITY PAGES</small>
                    <strong>{knowledgeLabel}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => openGuideProposalEditor()}
                    disabled={!canPost}
                  >
                    ＋
                  </button>
                </header>
                <nav>
                  {activeGuides
                    .filter((guide) => !guide.directoryId)
                    .map((guide) => (
                      <button
                        type="button"
                        key={guide.id}
                        className={
                          activeGuide?.id === guide.id && !selectedGuideProposal
                            ? "community-guide-site__active"
                            : ""
                        }
                        onClick={() => {
                          setActiveGuideId(guide.id);
                          setSelectedGuideProposalId(null);
                        }}
                      >
                        <strong>{guide.title}</strong>
                        <small>
                          v{guide.version} · {formatTime(guide.updatedAt)}
                        </small>
                      </button>
                    ))}
                  {activeGuideDirectories.map((directory) => (
                    <div
                      className="community-guide-directory"
                      key={directory.id}
                      style={
                        {
                          "--guide-directory-depth": guideDirectoryDepth(
                            directory,
                            activeGuideDirectories,
                          ),
                        } as CSSProperties
                      }
                    >
                      <header>
                        <span aria-hidden="true">▾</span>
                        <strong>{directory.name}</strong>
                      </header>
                      {activeGuides
                        .filter((guide) => guide.directoryId === directory.id)
                        .map((guide) => (
                          <button
                            type="button"
                            key={guide.id}
                            className={
                              activeGuide?.id === guide.id &&
                              !selectedGuideProposal
                                ? "community-guide-site__active"
                                : ""
                            }
                            onClick={() => {
                              setActiveGuideId(guide.id);
                              setSelectedGuideProposalId(null);
                            }}
                          >
                            <strong>{guide.title}</strong>
                            <small>
                              v{guide.version} · {formatTime(guide.updatedAt)}
                            </small>
                          </button>
                        ))}
                    </div>
                  ))}
                </nav>
                <section>
                  <header>
                    <strong>編集提案</strong>
                    <small>
                      {
                        activeGuideProposals.filter(
                          (proposal) =>
                            proposal.status === "open" ||
                            proposal.status === "changes_requested",
                        ).length
                      }
                      件
                    </small>
                  </header>
                  {activeGuideProposals.map((proposal) => (
                    <button
                      type="button"
                      key={proposal.id}
                      className={
                        selectedGuideProposal?.id === proposal.id
                          ? "community-guide-site__active"
                          : ""
                      }
                      onClick={() => setSelectedGuideProposalId(proposal.id)}
                    >
                      <span
                        className={`community-guide-pr-status community-guide-pr-status--${proposal.status}`}
                      >
                        {proposal.status === "open"
                          ? "レビュー中"
                          : proposal.status === "changes_requested"
                            ? "修正依頼"
                            : proposal.status === "merged"
                              ? "マージ済み"
                              : "終了"}
                      </span>
                      <strong>{proposal.title}</strong>
                      <small>{proposal.authorName}</small>
                    </button>
                  ))}
                </section>
              </aside>
            )}
            <article className="community-guide-site__content">
              {selectedGuideProposal ? (
                <>
                  <header className="community-guide-proposal__header">
                    <div>
                      <small>
                        EDIT PROPOSAL · #{selectedGuideProposal.id.slice(-6)}
                      </small>
                      <h2>{selectedGuideProposal.title}</h2>
                      <p>{selectedGuideProposal.summary}</p>
                    </div>
                    <span
                      className={`community-guide-pr-status community-guide-pr-status--${selectedGuideProposal.status}`}
                    >
                      {selectedGuideProposal.status === "open"
                        ? "レビュー中"
                        : selectedGuideProposal.status === "changes_requested"
                          ? "修正依頼"
                          : selectedGuideProposal.status === "merged"
                            ? "マージ済み"
                            : "終了"}
                    </span>
                  </header>
                  <dl className="community-guide-proposal__meta">
                    <div>
                      <dt>提案者</dt>
                      <dd>{selectedGuideProposal.authorName}</dd>
                    </div>
                    <div>
                      <dt>ベース</dt>
                      <dd>
                        {selectedGuideProposal.pageId
                          ? `v${selectedGuideProposal.baseVersion}`
                          : "新規ページ"}
                      </dd>
                    </div>
                    <div>
                      <dt>更新</dt>
                      <dd>{formatTime(selectedGuideProposal.updatedAt)}</dd>
                    </div>
                  </dl>
                  <section className="community-guide-diff">
                    <div>
                      <header>現在のページ</header>
                      <strong>
                        {activeGuides.find(
                          (guide) => guide.id === selectedGuideProposal.pageId,
                        )?.title ?? "新規ページ"}
                      </strong>
                      <pre>
                        {activeGuides.find(
                          (guide) => guide.id === selectedGuideProposal.pageId,
                        )?.body ?? "（まだ公開されていません）"}
                      </pre>
                    </div>
                    <div>
                      <header>提案後</header>
                      <strong>{selectedGuideProposal.proposedTitle}</strong>
                      <pre>{selectedGuideProposal.proposedBody}</pre>
                    </div>
                  </section>
                  <section className="community-guide-reviews">
                    <header>
                      <h2>レビュー</h2>
                      <small>{selectedGuideProposal.reviews.length}件</small>
                    </header>
                    {selectedGuideProposal.reviews.map((review) => (
                      <article key={review.id}>
                        <header>
                          <strong>{review.authorName}</strong>
                          <span>
                            {review.decision === "approve"
                              ? "承認"
                              : review.decision === "request_changes"
                                ? "修正依頼"
                                : "コメント"}
                          </span>
                          <time>{formatTime(review.createdAt)}</time>
                        </header>
                        <p>{review.body}</p>
                      </article>
                    ))}
                    {selectedGuideProposal.status !== "merged" &&
                      selectedGuideProposal.status !== "closed" && (
                        <footer>
                          <textarea
                            value={guideReviewBody}
                            onChange={(event) =>
                              setGuideReviewBody(event.target.value)
                            }
                            maxLength={2000}
                            placeholder="根拠や修正点をレビュー"
                          />
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                submitGuideReview(
                                  selectedGuideProposal,
                                  "comment",
                                )
                              }
                              disabled={!guideReviewBody.trim() || isPending}
                            >
                              コメント
                            </button>
                            {canManageChannels && currentMember?.id !==
                              selectedGuideProposal.authorProfileId && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    submitGuideReview(
                                      selectedGuideProposal,
                                      "request_changes",
                                    )
                                  }
                                  disabled={
                                    !guideReviewBody.trim() || isPending
                                  }
                                >
                                  修正を依頼
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    submitGuideReview(
                                      selectedGuideProposal,
                                      "approve",
                                    )
                                  }
                                  disabled={
                                    !guideReviewBody.trim() || isPending
                                  }
                                >
                                  承認
                                </button>
                              </>
                            )}
                            {canManageChannels &&
                              selectedGuideProposal.status === "open" &&
                              selectedGuideProposal.reviews.some(
                                (review) =>
                                  review.decision === "approve" &&
                                  review.authorProfileId !==
                                    selectedGuideProposal.authorProfileId,
                              ) && (
                                <button
                                  type="button"
                                  className="community-guide-merge"
                                  onClick={() =>
                                    updateGuideProposal(
                                      selectedGuideProposal,
                                      "merge",
                                    )
                                  }
                                  disabled={isPending}
                                >
                                  マージして公開
                                </button>
                              )}
                            {canManageChannels &&
                              selectedGuideProposal.status === "open" &&
                              !selectedGuideProposal.reviews.some(
                                (review) =>
                                  review.decision === "approve" &&
                                  review.authorProfileId !==
                                    selectedGuideProposal.authorProfileId,
                              ) && (
                                <small className="community-guide-approval-waiting">
                                  他の有効な管理者の承認後にマージできます
                                </small>
                              )}
                            {canManageChannels && <button
                              type="button"
                              onClick={() =>
                                updateGuideProposal(
                                  selectedGuideProposal,
                                  "close",
                                )
                              }
                              disabled={isPending}
                            >
                              終了
                            </button>}
                          </div>
                        </footer>
                      )}
                    {canManageChannels && selectedGuideProposal.status === "closed" && (
                      <button
                        type="button"
                        onClick={() =>
                          updateGuideProposal(selectedGuideProposal, "reopen")
                        }
                        disabled={isPending}
                      >
                        編集提案を再開
                      </button>
                    )}
                  </section>
                </>
              ) : activeGuide ? (
                <div className="community-guide-reader">
                  <nav
                    className="community-guide-breadcrumb"
                    aria-label="ページの現在位置"
                  >
                    <button
                      type="button"
                      onClick={() => setWorkspaceView("home")}
                    >
                      {activeCommunity.name}
                    </button>
                    <span aria-hidden="true">/</span>
                    <strong>{knowledgeLabel}</strong>
                    {activeGuideDirectory && (
                      <>
                        <span aria-hidden="true">/</span>
                        <strong>{activeGuideDirectory.name}</strong>
                      </>
                    )}
                    <span aria-hidden="true">/</span>
                    <em>{activeGuide.title}</em>
                  </nav>
                  <header className="community-guide-article__header">
                    <div>
                      <span className="community-guide-article__eyebrow">
                        <small>
                          {activeGuideDirectory?.name ?? knowledgeLabel}
                        </small>
                        <em>v{activeGuide.version}</em>
                      </span>
                      <h2>{activeGuide.title}</h2>
                      <p>
                        {activeGuide.updatedBy}が
                        {formatTime(activeGuide.updatedAt)}に更新
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openGuideProposalEditor(activeGuide)}
                      disabled={!canPost}
                    >
                      変更を提案
                    </button>
                  </header>
                  <GuideVerificationControl communityId={activeCommunity.id} pageId={activeGuide.id} status={activeGuide.verificationStatus} count={activeGuide.verificationCount} gameVersion={activeGuide.gameVersion} />
                  <dl className="community-guide-article__facts">
                    <div>
                      <dt>分類</dt>
                      <dd>{activeGuideDirectory?.name ?? "トップページ"}</dd>
                    </div>
                    <div>
                      <dt>バージョン</dt>
                      <dd>v{activeGuide.version}</dd>
                    </div>
                    <div>
                      <dt>最終更新</dt>
                      <dd>{formatTime(activeGuide.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>編集提案</dt>
                      <dd>{openGuideProposalCount}件</dd>
                    </div>
                  </dl>
                  <pre className="community-guide-article__body">
                    {activeGuide.body}
                  </pre>
                  {activeGuideSiblings.length > 0 && (
                    <nav
                      className="community-guide-related"
                      aria-label="同じ分類のページ"
                    >
                      <header>
                        <small>SAME DIRECTORY</small>
                        <strong>同じ分類のページ</strong>
                      </header>
                      <div>
                        {activeGuideSiblings.map((guide) => (
                          <button
                            type="button"
                            key={guide.id}
                            onClick={() => {
                              setActiveGuideId(guide.id);
                              setSelectedGuideProposalId(null);
                            }}
                          >
                            <span>{guide.title}</span>
                            <small>v{guide.version}</small>
                          </button>
                        ))}
                      </div>
                    </nav>
                  )}
                </div>
              ) : (
                <div className="community-guide-empty">
                  <strong>{knowledgeLabel}はまだありません</strong>
                  <p>
                    最初の編集提案を作成し、レビュー後に反映すると公開されます。
                  </p>
                  <button
                    type="button"
                    onClick={() => openGuideProposalEditor()}
                    disabled={!canPost}
                  >
                    最初の{knowledgeLabel}ページを提案
                  </button>
                </div>
              )}
              {error && (
                <p className="community-error" role="alert">
                  {error}
                </p>
              )}
            </article>
          </section>
        )}
        <section
          className="community-posts-view"
          hidden={workspaceView !== "posts"}
          aria-label={`${activeCommunity?.name ?? "コミュニティ"}の投稿`}
        >
          {activeCommunity ? (
            <>
              <header className="community-posts-view__header">
                <div>
                  <h2>投稿</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveChannelId(activeChannels[0]?.id ?? "");
                    setWorkspaceView("feed");
                  }}
                  disabled={!activeChannels.length || !canPost}
                >
                  投稿を作成
                </button>
              </header>
              <nav className="community-posts-sort" aria-label="投稿の並び順">
                {(
                  [
                    ["popular", "人気"],
                    ["new", "新着"],
                    ["rising", "急上昇"],
                    ["top", "上位"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={communityPostSort === value ? "active" : ""}
                    aria-pressed={communityPostSort === value}
                    onClick={() => setCommunityPostSort(value)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="community-posts-tools">
                <div className="community-posts-flairs" aria-label="投稿フレア">
                  {(
                    [
                      ["all", "すべて"],
                      ["chat", "雑談"],
                      ["guide", knowledgeLabel],
                      ["question", "質問"],
                      ["party", "募集"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={communityPostFilter === value ? "active" : ""}
                      aria-pressed={communityPostFilter === value}
                      onClick={() => setCommunityPostFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="community-posts-search">
                  <span className="sr-only">コミュニティの投稿を検索</span>
                  <input
                    type="search"
                    value={communityPostQuery}
                    onChange={(event) => setCommunityPostQuery(event.target.value)}
                    placeholder="投稿、ユーザー、チャンネルを検索"
                  />
                </label>
              </div>
              <div className="community-posts-list" aria-live="polite">
                {communityPostResults.map((message) => {
                  const engagement = message.engagement ?? {
                    replyCount: 0,
                    likeCount: 0,
                    liked: false,
                    bookmarked: false,
                  };
                  const score = engagement.likeCount + engagement.replyCount;
                  return (
                    <article
                      className="community-reddit-post tweet community-post-card"
                      key={`${message.channelId}:${message.id}`}
                    >
                      <Avatar
                        name={message.displayName}
                        url={message.avatarUrl}
                        className="tweet__avatar community-post-card__avatar"
                      />
                      <PostContentFrame className="community-reddit-post__content community-post-card__content">
                        <PostAuthorRow
                          className="community-post-card__header"
                          name={<strong className="tweet__name">{message.displayName}</strong>}
                          handle={message.handle ? <span className="tweet__handle">@{message.handle}</span> : null}
                          badges={<>
                          <a
                            className="community-post-card__channel"
                            href={communityMessageHref(
                              message.channelId,
                              message.id,
                            )}
                            onClick={(event) => {
                              event.preventDefault();
                              openCommunityChannel(message.channelId);
                            }}
                          >
                            {message.channelName}
                          </a>
                          <span className="community-message-kind community-message-kind--chat">
                            {messageKindLabels[message.kind ?? "chat"]}
                          </span>
                          {message.pinned ? <span className="community-message-pinned">固定</span> : null}
                          {message.workflowStatus === "resolved" ? <span className="community-message-workflow community-message-workflow--resolved">解決済み</span> : null}
                          {message.workflowStatus === "closed" ? <span className="community-message-workflow community-message-workflow--closed">募集終了</span> : null}
                          <span className="community-post-card__score" aria-label={`スコア ${score}`}>
                            <span className="sr-only">スコア</span>{score}
                          </span>
                          </>}
                          meta={<time className="tweet__time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>}
                          contextActions={<PostContextActions
                            body={message.body}
                            targetId={message.id}
                            targetType="community_message"
                            href={communityMessageHref(
                              message.channelId,
                              message.id,
                            )}
                            locale={locale}
                          />}
                        />
                        <TranslatedText
                          className="tweet__text community-post-card__text"
                          locale={locale}
                          targetId={message.id}
                          targetType="community_message"
                          text={message.body}
                        />
                        <EngagementBar
                          summary={{
                            targetType: "community_message",
                            targetId: message.id,
                            replyCount: engagement.replyCount,
                            repostCount: engagement.repostCount ?? 0,
                            quoteRepostCount: engagement.quoteRepostCount ?? 0,
                            likeCount: engagement.likeCount,
                            score,
                            bookmarked: engagement.bookmarked,
                            viewerReaction: engagement.liked ? "like" : null,
                          }}
                          repostDestination="feed"
                          onReply={() => {
                            setActiveChannelId(message.channelId);
                            setWorkspaceView("feed");
                            setReplyingTo(message);
                          }}
                          shareHref={communityMessageHref(
                            message.channelId,
                            message.id,
                          )}
                          disabled={!canPost}
                        />
                      </PostContentFrame>
                    </article>
                  );
                })}
                {!communityPostResults.length ? (
                  <div className="community-message-empty">
                    <strong>該当する投稿はありません</strong>
                    <p>条件を変えるか、最初の投稿を作成してください。</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
        <div className="community-feed-view" hidden={workspaceView !== "feed"}>
          {activeCommunity && activeChannel ? (
            <>
              <header className="community-chat-header">
                <div>
                  <span aria-hidden="true">#</span>
                  <span>
                    <h2>{activeChannel.name}</h2>
                    <p>{activeChannel.description}</p>
                  </span>
                </div>
                <span className="community-chat-header__game-actions">
                  <small>{activeCommunity.name}</small>
                  <button
                    type="button"
                    className={
                      showPinnedMessages
                        ? "community-pinned-toggle community-pinned-toggle--active"
                        : "community-pinned-toggle"
                    }
                    onClick={() => setShowPinnedMessages((current) => !current)}
                    disabled={!pinnedMessages.length}
                  >
                    固定 {pinnedMessages.length}
                  </button>
                </span>
              </header>
              <nav className="community-game-filters" aria-label="投稿カテゴリ">
                {(["all", "guide", "question", "party"] as const)
                  .filter((kind) => kind !== "guide" || hasGuideContent)
                  .map((kind) => (
                    <button
                      type="button"
                      key={kind}
                      className={
                        messageFilter === kind && !workflowOnlyOpen
                          ? "community-game-filter--active"
                          : ""
                      }
                      aria-pressed={messageFilter === kind && !workflowOnlyOpen}
                      onClick={() => {
                        setMessageFilter(kind);
                        setWorkflowOnlyOpen(false);
                      }}
                    >
                      {kind === "all" ? "すべて" : messageKindLabels[kind]}
                    </button>
                  ))}
                <label className="community-game-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={messageQuery}
                    onChange={(event) => setMessageQuery(event.target.value)}
                    aria-label="チャンネル内を検索"
                    placeholder={
                      hasGuideContent ? `${knowledgeLabel}を検索` : "投稿を検索"
                    }
                  />
                </label>
              </nav>
              {showPinnedMessages && (
                <section
                  className="community-pinned-posts"
                  aria-label={
                    hasGuideContent
                      ? `固定された${knowledgeLabel}投稿`
                      : "固定された投稿"
                  }
                >
                  <header>
                    <strong>
                      {hasGuideContent
                        ? `固定された${knowledgeLabel}`
                        : "固定された投稿"}
                    </strong>
                    <small>{pinnedMessages.length}件</small>
                  </header>
                  {pinnedMessages.map((message, messageIndex) => (
                    <a
                      href={`#${message.id}`}
                      key={`${message.id}:${messageIndex}`}
                      onClick={() => setShowPinnedMessages(false)}
                    >
                      <span>{messageKindLabels[message.kind ?? "chat"]}</span>
                      <strong>{message.body}</strong>
                      <small>{message.displayName}</small>
                    </a>
                  ))}
                </section>
              )}
              <div className="community-messages" aria-live="polite">
                {visibleMessages.map((message, messageIndex) => {
                  const mine = message.authorProfileId === currentMember?.id;
                  const reported = reportedMessageIds.has(message.id);
                  const engagement = message.engagement ?? {
                    replyCount: 0,
                    likeCount: 0,
                    liked: false,
                    bookmarked: false,
                  };
                  const managementMenu = (
                    <details className="community-message__menu">
                      <summary aria-label="投稿メニュー">•••</summary>
                      <div>
                        {canManageChannels && (
                          <button
                            type="button"
                            aria-label={
                              message.pinned
                                ? "メッセージの固定を解除"
                                : "メッセージを固定"
                            }
                            onClick={() => togglePinnedMessage(message)}
                          >
                            {message.pinned
                              ? "固定を解除"
                              : `${knowledgeLabel}として固定`}
                          </button>
                        )}
                        {(mine || canManageChannels) &&
                          message.kind === "question" && (
                            <button
                              type="button"
                              aria-label={
                                message.workflowStatus === "resolved"
                                  ? "質問を未解決に戻す"
                                  : "質問を解決済みにする"
                              }
                              onClick={() => toggleMessageWorkflow(message)}
                            >
                              {message.workflowStatus === "resolved"
                                ? "未解決に戻す"
                                : "解決済みにする"}
                            </button>
                          )}
                        {(mine || canManageChannels) &&
                          message.kind === "party" && (
                            <button
                              type="button"
                              aria-label={
                                message.workflowStatus === "closed"
                                  ? "募集を再開する"
                                  : "募集を締め切る"
                              }
                              onClick={() => toggleMessageWorkflow(message)}
                            >
                              {message.workflowStatus === "closed"
                                ? "募集を再開"
                                : "募集を締め切る"}
                            </button>
                          )}
                        {mine && (
                          <button
                            type="button"
                            aria-label="メッセージを編集"
                            onClick={() => editMessage(message)}
                          >
                            編集
                          </button>
                        )}
                        {(mine || canManageChannels) && (
                          <button
                            type="button"
                            aria-label="メッセージを削除"
                            onClick={() => removeMessage(message.id)}
                          >
                            削除
                          </button>
                        )}
                        {!mine && (
                          <button
                            type="button"
                            className="community-message__report-trigger"
                            aria-label="メッセージを通報"
                            onClick={() => reportMessage(message.id)}
                            disabled={reported}
                          >
                            {reported ? "通報済み" : "通報"}
                          </button>
                        )}
                      </div>
                    </details>
                  );
                  return (
                    <article
                      className="community-message tweet community-post-card"
                      id={message.id}
                      tabIndex={-1}
                      key={`${message.id}:${messageIndex}`}
                    >
                      <Avatar
                        name={message.displayName}
                        url={message.avatarUrl}
                        className="tweet__avatar community-post-card__avatar"
                      />
                      <PostContentFrame className="community-message__content community-post-card__content">
                        {message.replyTo && (
                          <a
                            href={`#${message.replyTo.id}`}
                            className="community-message__reply tweet__thread-context"
                          >
                            <span>↳</span>
                            <strong>{message.replyTo.displayName}</strong>
                            <small>{message.replyTo.body}</small>
                          </a>
                        )}
                        <PostAuthorRow
                          className="community-post-card__header"
                          name={<strong className="tweet__name">
                            {message.botName ?? message.displayName}
                          </strong>}
                          handle={message.handle ? (
                            <span className="tweet__handle">
                              @{message.handle}
                            </span>
                          ) : null}
                          badges={<>
                          {message.botId && (
                            <span className="community-message-bot">BOT</span>
                          )}
                          {(message.kind ?? "chat") !== "chat" && (
                            <span
                              className={`community-message-kind community-message-kind--${message.kind}`}
                            >
                              {messageKindLabels[message.kind ?? "chat"]}
                            </span>
                          )}
                          {message.pinned && (
                            <span className="community-message-pinned">
                              固定
                            </span>
                          )}
                          {message.kind === "question" &&
                            message.workflowStatus === "resolved" && (
                              <span className="community-message-workflow community-message-workflow--resolved">
                                解決済み
                              </span>
                            )}
                          {message.kind === "party" &&
                            message.workflowStatus === "closed" && (
                              <span className="community-message-workflow community-message-workflow--closed">
                                募集終了
                              </span>
                            )}
                          </>}
                          meta={<time
                            className="tweet__time"
                            dateTime={message.createdAt}
                          >
                            {formatTime(message.createdAt)}
                            {message.editedAt && "（編集済み）"}
                          </time>}
                          contextActions={<PostContextActions
                            body={message.body}
                            targetId={message.id}
                            targetType="community_message"
                            href={communityMessageHref(
                              activeChannel.id,
                              message.id,
                            )}
                          />}
                          menu={managementMenu}
                        />
                        <TranslatedText
                          className="tweet__text community-post-card__text"
                          locale={locale}
                          targetId={message.id}
                          targetType="community_message"
                          text={message.body}
                        />
                        {(message as CommunityChannelMessageView).images?.length ? <div className="community-message-images">{(message as CommunityChannelMessageView).images!.map((image) => <img key={image.id} src={image.url} width={image.width} height={image.height} alt={image.altText} loading="lazy" />)}</div> : null}
                        {pollOptions.some((option) => option.messageId === message.id) && (
                          <div className="community-message-poll" aria-label="アンケート">
                            {pollOptions.filter((option) => option.messageId === message.id).map((option) => {
                              const total = pollOptions.filter((item) => item.messageId === message.id).reduce((sum, item) => sum + Number(item.voteCount), 0);
                              const percent = total ? Math.round(Number(option.voteCount) / total * 100) : 0;
                              return <button type="button" key={option.optionId} className={option.voted ? "is-voted" : ""} onClick={() => votePoll(option.optionId)} disabled={!canPost || isPending}><span>{option.label}</span><strong>{percent}%・{option.voteCount}票</strong></button>;
                            })}
                          </div>
                        )}
                        <EngagementBar
                          summary={{
                            targetType: "community_message",
                            targetId: message.id,
                            replyCount: engagement.replyCount,
                            repostCount: engagement.repostCount ?? 0,
                            quoteRepostCount: engagement.quoteRepostCount ?? 0,
                            likeCount: engagement.likeCount,
                            score:
                              engagement.likeCount +
                              engagement.replyCount * 2 +
                              (engagement.repostCount ?? 0) * 3 +
                              (engagement.quoteRepostCount ?? 0) * 4,
                            bookmarked: engagement.bookmarked,
                            viewerReaction: engagement.liked ? "like" : null,
                          }}
                          onReply={() => setReplyingTo(message)}
                          shareHref={communityMessageHref(
                            activeChannel.id,
                            message.id,
                          )}
                          disabled={!canPost}
                        />
                      </PostContentFrame>
                    </article>
                  );
                })}
                {!visibleMessages.length && (
                  <div className="community-message-empty">
                    <strong>
                      {messages.length
                        ? "このカテゴリの投稿はまだありません"
                        : `#${activeChannel.name} の始まりです`}
                    </strong>
                    <p>
                      {messages.length
                        ? "別のカテゴリを見るか、最初の投稿を作成してください。"
                        : "最初のメッセージを送ってみましょう。"}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="community-no-channels">
              <strong>チャンネルはまだありません</strong>
              <p>コミュニティの管理者がチャンネルを作成できます。</p>
            </div>
          )}
        </div>
        {activeCommunity && activeChannel && (
          <footer className="community-composer community-composer--persistent">
            {replyingTo && (
              <div className="community-composer__reply">
                <span>
                  <strong>{replyingTo.displayName}</strong>に返信
                </span>
                <small>{replyingTo.body}</small>
                <button
                  type="button"
                  aria-label="返信を取り消す"
                  onClick={() => setReplyingTo(null)}
                >
                  ×
                </button>
              </div>
            )}
            <div
              className="community-composer-kinds"
              aria-label="投稿カテゴリ"
            >
              {(["chat", "guide", "question", "party"] as const)
                .filter((kind) => kind !== "guide" || hasGuideContent)
                .map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={
                      messageKind === kind
                        ? "community-composer-kind--active"
                        : ""
                    }
                    aria-pressed={messageKind === kind}
                    onClick={() => setMessageKind(kind)}
                    disabled={!canPost}
                  >
                    {messageKindLabels[kind]}
                  </button>
                ))}
            </div>
            <details className="community-composer-tools">
              <summary aria-label="投稿ツールを開く" title="投稿ツール">＋</summary>
              <div className="community-composer-tools__menu" aria-label="投稿ツール">
                <button type="button" disabled={!canPost} onClick={createPoll}>アンケート</button>
                <button type="button" disabled={!canPost || !draft.trim()} onClick={scheduleCurrentDraft}>予約投稿</button>
                <button type="button" disabled={!canPost} onClick={() => { setMessageKind("question"); setDraft("質問：\n試したこと：\n環境・バージョン：\n"); }}>質問テンプレート</button>
                <button type="button" disabled={!canPost} onClick={() => { setMessageKind("party"); setDraft("募集内容：\n日時：\n参加条件：\n募集人数：\n"); }}>募集テンプレート</button>
                {hasGuideContent && <button type="button" disabled={!canPost} onClick={() => { setMessageKind("guide"); setDraft("目的：\n手順：\n注意点：\n確認したバージョン：\n"); }}>攻略テンプレート</button>}
                <label>
                  <span>画像を添付</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!canPost || isPending || communityImageIds.length >= 4} onChange={(event) => { void uploadCommunityImages(event.target.files); event.currentTarget.value = ""; }} />
                </label>
                <small>画像は最大4枚。安全検査後に公開されます。</small>
              </div>
            </details>
            {communityImageNames.length > 0 && <div className="community-composer__attachments">
              {communityImageNames.map((name, index) => <span key={`${name}-${index}`}><strong>{name}</strong><label>画像の説明（任意）<input value={communityImageAltTexts[index] ?? ""} maxLength={300} aria-label={`${name}の画像説明`} onChange={(event) => setCommunityImageAltTexts((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onBlur={() => void saveCommunityImageAltText(index)} /></label><button type="button" onClick={() => { setCommunityImageNames((current) => current.filter((_, itemIndex) => itemIndex !== index)); setCommunityImageIds((current) => current.filter((_, itemIndex) => itemIndex !== index)); setCommunityImageAltTexts((current) => current.filter((_, itemIndex) => itemIndex !== index)); }}>削除</button></span>)}
            </div>}
            <div className="community-composer__box">
              <textarea
                aria-label={`${activeChannel.name}にメッセージを送信`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  )
                    submitMessage();
                }}
                maxLength={2000}
                placeholder={
                  canPost
                    ? `${messageKindLabels[messageKind]}を #${activeChannel.name} に投稿`
                    : activeCommunity.viewerStatus === "muted"
                      ? "ミュート中は投稿できません"
                      : "コミュニティに参加すると投稿できます"
                }
                disabled={isPending || !canPost}
              />
              <button
                type="button"
                onClick={submitMessage}
                disabled={isPending || !canPost || !draft.trim()}
              >
                {isPending ? "送信中…" : "送信"}
              </button>
            </div>
            <div className="community-composer__meta">
              {(replyingTo || messageKind !== "chat") && <small>
                {replyingTo ? "返信として投稿されます" : `${messageKindLabels[messageKind]}として投稿されます`}
              </small>}
              <span>下書き自動保存・{draft.length}/2000</span>
            </div>
            {error && !showCreateCommunity && !showCreateChannel && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
          </footer>
        )}
      </section>

      {sidePanelOpen && (
      <aside
        ref={sidePanelRef}
        className="community-members"
        aria-label="コミュニティメンバー"
      >
        {workspaceView === "guides" && (
          <>
            <section
              className="community-guide-pr-panel"
              aria-label={`${knowledgeLabel}編集提案`}
            >
              <header>
                <span>
                  <strong>編集提案</strong>
                  <small>{knowledgeLabel}ページの修正案</small>
                </span>
                <button
                  type="button"
                  onClick={() => setWorkspaceView("guides")}
                >
                  すべて
                </button>
              </header>
              <div>
                {activeGuideProposals
                  .filter(
                    (proposal) =>
                      proposal.status === "open" ||
                      proposal.status === "changes_requested",
                  )
                  .slice(0, 4)
                  .map((proposal) => (
                    <button
                      type="button"
                      key={proposal.id}
                      onClick={() => {
                        setSelectedGuideProposalId(proposal.id);
                        setWorkspaceView("guides");
                      }}
                    >
                      <span
                        className={`community-guide-pr-status community-guide-pr-status--${proposal.status}`}
                      >
                        {proposal.status === "changes_requested"
                          ? "修正依頼"
                          : "レビュー中"}
                      </span>
                      <strong>{proposal.title}</strong>
                      <small>
                        {proposal.authorName} · {formatTime(proposal.updatedAt)}
                      </small>
                    </button>
                  ))}
                {!activeGuideProposals.some(
                  (proposal) =>
                    proposal.status === "open" ||
                    proposal.status === "changes_requested",
                ) && <p>レビュー待ちの編集提案はありません。</p>}
              </div>
              <button
                type="button"
                className="community-guide-pr-panel__new"
                onClick={() => {
                  setActiveGuideId("");
                  setGuideProposalTitle("");
                  setGuideProposedTitle("");
                  setGuideProposedBody("");
                  setGuideProposalSummary("");
                  setShowGuideProposalEditor(true);
                }}
                disabled={!canPost}
              >
                ＋ 新しい{knowledgeLabel}ページを提案
              </button>
            </section>
            <section
              className="community-game-index"
              aria-label={`${knowledgeLabel}インデックス`}
            >
              <header>
                <strong>{knowledgeLabel}インデックス</strong>
                <small>#{activeChannel?.name}</small>
              </header>
              <button
                type="button"
                onClick={() => {
                  setMessageQuery("");
                  setMessageFilter("guide");
                  setWorkflowOnlyOpen(false);
                  setWorkspaceView("home");
                }}
              >
                <span>{knowledgeLabel}</span>
                <strong>{gameIndex.guides}</strong>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessageQuery("");
                  setMessageFilter("question");
                  setWorkflowOnlyOpen(true);
                  setWorkspaceView("home");
                }}
              >
                <span>未解決の質問</span>
                <strong>{gameIndex.unresolvedQuestions}</strong>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessageQuery("");
                  setMessageFilter("party");
                  setWorkflowOnlyOpen(true);
                  setWorkspaceView("home");
                }}
              >
                <span>募集中</span>
                <strong>{gameIndex.recruitingParties}</strong>
              </button>
            </section>
          </>
        )}
        <header>
          <span>メンバー</span>
          <small>{communityMembers.length}</small>
        </header>
        <div className="community-member-list">
          {communityMembers.slice(0, visibleMemberLimit).map((member) => {
            const role =
              memberRolesByCommunity.get(activeCommunity?.id ?? "")?.[
                member.id
              ] ?? activeCommunity?.memberRoles[member.id] ?? "member";
            const status =
              memberStatusesByCommunity.get(activeCommunity?.id ?? "")?.[
                member.id
              ] ?? "active";
            const roleLabel =
              role === "owner"
                ? "オーナー"
                : role === "moderator"
                  ? "モデレーター"
                  : "メンバー";
            return (
              <div className="community-member" key={member.id}>
                <button
                  type="button"
                  className="community-member__trigger"
                  aria-label={`${member.displayName}のプロフィールを表示`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMemberProfilePopover({
                      memberId: member.id,
                      top: Math.max(
                        12,
                        Math.min(window.innerHeight - 470, rect.top - 90),
                      ),
                      right: Math.max(12, window.innerWidth - rect.left + 12),
                    });
                  }}
                >
                  <strong>{member.displayName}</strong>
                  <small className={`community-member__role is-${role}`}>
                    {roleLabel}
                  </small>
                </button>
                {isOwner && role !== "owner" && (
                  <details className="community-management-menu community-member__actions">
                    <summary aria-label={`${member.displayName}の管理メニュー`}>•••</summary>
                    <div>
                      <button type="button" aria-label={`${member.displayName}を${role === "moderator" ? "メンバーに戻す" : "モデレーターにする"}`} onClick={() => requestSensitiveMemberAction(member.id, member.displayName, role === "moderator" ? "demote" : "promote")}>
                        {role === "moderator" ? "メンバーに戻す" : "モデレーターにする"}
                      </button>
                      <button type="button" aria-label={`${member.displayName}を${status === "muted" ? "ミュート解除" : "ミュート"}`} onClick={() => manageMember(member.id, status === "muted" ? "unmute" : "mute")}>
                        {status === "muted" ? "ミュートを解除" : "ミュートする"}
                      </button>
                      <button type="button" className="community-management-menu__danger" aria-label={`${member.displayName}をBAN`} onClick={() => requestSensitiveMemberAction(member.id, member.displayName, "ban")}>
                        コミュニティからBAN
                      </button>
                    </div>
                  </details>
                )}
              </div>
            );
          })}
          {communityMembers.length > visibleMemberLimit && <button type="button" className="community-member-list__more" onClick={() => setVisibleMemberLimit((current) => current + 20)}>さらに20人表示</button>}
        </div>
      </aside>
      )}

      {memberProfilePopover && selectedMember && (
        <div
          className="community-member-profile-layer"
          role="presentation"
          onMouseDown={() => setMemberProfilePopover(null)}
        >
          <section
            className="community-member-profile-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedMember.displayName}のプロフィール`}
            style={{
              top: `${memberProfilePopover.top}px`,
              right: `${memberProfilePopover.right}px`,
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="community-member-profile-card__banner">
              {activeCommunity && communityImagesById.get(activeCommunity.id) && (
                <img
                  src={communityImagesById.get(activeCommunity.id)}
                  alt=""
                />
              )}
              <button
                type="button"
                aria-label="プロフィールカードを閉じる"
                onClick={() => setMemberProfilePopover(null)}
              >
                ×
              </button>
            </div>
            <div className="community-member-profile-card__avatar">
              <Avatar
                name={selectedMember.displayName}
                url={selectedMember.avatarUrl}
              />
              <i aria-label="オンライン" />
            </div>
            <div className="community-member-profile-card__body">
              <header>
                <div>
                  <h2>{selectedMember.displayName}</h2>
                  <span>@{selectedMember.handle}</span>
                </div>
                <em>
                  {selectedMemberRole === "owner"
                    ? "管理者"
                    : selectedMemberRole === "moderator"
                      ? "モデレーター"
                      : "メンバー"}
                </em>
              </header>
              {selectedMemberStatus === "muted" && (
                <p className="community-member-profile-card__notice">
                  このメンバーは現在ミュート中です。
                </p>
              )}
              <section>
                <small>自己紹介</small>
                <p>{selectedMember.bio || "自己紹介はまだありません。"}</p>
              </section>
              {selectedMemberHoldings.length > 0 && (
                <section>
                  <small>コミュニティトークン</small>
                  <div className="community-member-profile-card__tokens">
                    {selectedMemberHoldings.map((holding) => (
                      <span key={holding.symbol}>
                        <strong>{formatAmount(holding.amount)}</strong>
                        {holding.symbol}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              <footer>
                <a href={hubSurfacePath(surface, `/profile/${selectedMember.handle}`)}>
                  プロフィールを見る
                </a>
              </footer>
            </div>
          </section>
        </div>
      )}

      {pendingMembershipCancellation && (
        <div className="community-modal-backdrop" role="presentation">
          <section className="community-modal" role="alertdialog" aria-modal="true" aria-labelledby="membership-cancel-title" aria-describedby="membership-cancel-description">
            <header>
              <div><span>MEMBERSHIP REQUEST</span><h2 id="membership-cancel-title">参加申請を取り消しますか？</h2></div>
              <button type="button" aria-label="閉じる" onClick={() => setPendingMembershipCancellation(null)} disabled={isPending}>×</button>
            </header>
            <p id="membership-cancel-description">
              <strong>{pendingMembershipCancellation.communityName}</strong> への審査中の参加申請を取り消します。取消後は、必要なときにあらためて申請できます。
            </p>
            {error && <p className="community-error" role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={() => setPendingMembershipCancellation(null)} disabled={isPending}>申請を保つ</button>
              <button type="button" className="community-modal__danger" onClick={cancelMembershipRequest} disabled={isPending}>{isPending ? "取消処理中…" : "参加申請を取り消す"}</button>
            </footer>
          </section>
        </div>
      )}

      {pendingChannelDelete && (
        <div className="community-modal-backdrop" role="presentation">
          <section className="community-modal" role="alertdialog" aria-modal="true" aria-labelledby="channel-delete-title" aria-describedby="channel-delete-description">
            <header>
              <div><span>DELETE CHANNEL</span><h2 id="channel-delete-title">チャンネルを削除しますか？</h2></div>
              <button type="button" aria-label="閉じる" onClick={() => setPendingChannelDelete(null)}>×</button>
            </header>
            <p id="channel-delete-description">
              <strong>#{pendingChannelDelete.name}</strong> と、このチャンネルにある
              {pendingChannelDelete.messageCount}件の投稿が完全に削除されます。この操作は取り消せません。
            </p>
            {error && <p className="community-error" role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={() => setPendingChannelDelete(null)}>キャンセル</button>
              <button type="button" className="community-modal__danger" onClick={() => removeChannel(pendingChannelDelete.id)} disabled={isPending}>{isPending ? "削除中…" : "チャンネルを削除"}</button>
            </footer>
          </section>
        </div>
      )}

      {pendingMemberAction && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal community-member-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="member-action-title"
          >
            <header>
              <div>
                <span>MEMBER PERMISSION</span>
                <h2 id="member-action-title">
                  {pendingMemberAction.action === "demote"
                    ? "モデレーターから外しますか？"
                    : pendingMemberAction.action === "promote"
                      ? "モデレーターにしますか？"
                      : "コミュニティからBANしますか？"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => {
                  setPendingMemberAction(null);
                  setMemberActionAcknowledged(false);
                }}
              >
                ×
              </button>
            </header>
            <div className="community-member-action-dialog__target">
              <strong>{pendingMemberAction.displayName}</strong>
              <span>
                {pendingMemberAction.action === "demote"
                  ? "チャンネル管理、投稿管理、メンバー対応の権限を失います。"
                  : pendingMemberAction.action === "promote"
                    ? "チャンネル管理、投稿管理、メンバー対応の権限を付与します。"
                    : "投稿と参加ができなくなり、メンバー一覧から外れます。"}
              </span>
            </div>
            <label className="community-member-action-dialog__acknowledgement">
              <input
                type="checkbox"
                checked={memberActionAcknowledged}
                onChange={(event) =>
                  setMemberActionAcknowledged(event.target.checked)
                }
              />
              <span>権限への影響を確認しました</span>
            </label>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                onClick={() => {
                  setPendingMemberAction(null);
                  setMemberActionAcknowledged(false);
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className={
                  pendingMemberAction.action === "promote"
                    ? "community-modal__primary"
                    : "community-modal__danger"
                }
                disabled={!memberActionAcknowledged || isPending}
                onClick={() =>
                  manageMember(
                    pendingMemberAction.profileId,
                    pendingMemberAction.action,
                  )
                }
              >
                {isPending
                  ? "更新中…"
                  : pendingMemberAction.action === "demote"
                    ? "モデレーターから外す"
                    : pendingMemberAction.action === "promote"
                      ? "モデレーターにする"
                      : "BANを実行"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showCreateChannel && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="channel-create-title"
          >
            <header>
              <div>
                <span>{editingChannelId ? "EDIT CHANNEL" : "NEW CHANNEL"}</span>
                <h2 id="channel-create-title">
                  チャンネルを{editingChannelId ? "編集" : "作成"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => {
                  setShowCreateChannel(false);
                  setEditingChannelId(null);
                }}
              >
                ×
              </button>
            </header>
            <p>
              {activeCommunity?.name}の中にあるチャットチャンネルを管理します。
            </p>
            <label>
              <span>チャンネル名</span>
              <input
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                maxLength={50}
                placeholder="例：お知らせ"
              />
            </label>
            <label>
              <span>説明</span>
              <textarea
                value={channelDescription}
                onChange={(event) => setChannelDescription(event.target.value)}
                maxLength={200}
              />
            </label>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                onClick={() => {
                  setShowCreateChannel(false);
                  setEditingChannelId(null);
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="community-modal__primary"
                onClick={createChannel}
                disabled={isPending || !channelName.trim()}
              >
                {isPending
                  ? "保存中…"
                  : editingChannelId
                    ? "変更を保存"
                    : "チャンネルを作成"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showAddToken && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="token-add-title"
          >
            <header>
              <div>
                <span>COMMUNITY TOKEN</span>
                <h2 id="token-add-title">トークンを追加</h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setShowAddToken(false)}
              >
                ×
              </button>
            </header>
            <p>
              公開トークン情報を登録して、コミュニティメンバーの公開保有量を表示します。ウォレットアドレスはHubに保存しません。
            </p>
            <label>
              <span>トークン名</span>
              <input
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
                maxLength={80}
                placeholder="例：USD Coin"
              />
            </label>
            <label>
              <span>シンボル</span>
              <input
                value={tokenSymbol}
                onChange={(event) =>
                  setTokenSymbol(event.target.value.toUpperCase())
                }
                maxLength={16}
                placeholder="USDC"
              />
            </label>
            <label>
              <span>ネットワーク</span>
              <input
                value={tokenNetwork}
                onChange={(event) => setTokenNetwork(event.target.value)}
                maxLength={40}
                placeholder="Ethereum"
              />
            </label>
            <label>
              <span>
                コントラクトアドレス <small>ネイティブトークンは空欄</small>
              </span>
              <input
                value={tokenContractAddress}
                onChange={(event) =>
                  setTokenContractAddress(event.target.value)
                }
                maxLength={128}
                placeholder="0x…"
              />
            </label>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setShowAddToken(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className="community-modal__primary"
                onClick={addCommunityToken}
                disabled={
                  isPending ||
                  !tokenName.trim() ||
                  !tokenSymbol.trim() ||
                  !tokenNetwork.trim()
                }
              >
                {isPending ? "登録中…" : "トークンを登録"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showCommunityNotifications && (
        <div className="community-modal-backdrop" role="presentation">
          <section className="community-modal" role="dialog" aria-modal="true" aria-labelledby="community-notifications-title">
            <header><div><span>NOTIFICATIONS</span><h2 id="community-notifications-title">コミュニティ通知</h2></div><button type="button" aria-label="閉じる" onClick={() => setShowCommunityNotifications(false)}>×</button></header>
            <p>このコミュニティから受け取る通知だけを調整できます。</p>
            <div className="community-notification-options">
              {([
                ["mentions", "メンション"], ["replies", "返信"], ["guideUpdates", "共同ページの更新"],
                ["governance", "ガバナンス"], ["membership", "参加申請・メンバー変更"],
              ] as const).map(([key, label]) => (
                <label key={key}><span>{label}</span><input type="checkbox" checked={communityNotifications[key]} onChange={(event) => setCommunityNotifications((current) => ({ ...current, [key]: event.target.checked }))} /></label>
              ))}
            </div>
            <div className="community-channel-notification-options">
              <strong>チャンネル別</strong>
              {activeChannels.map((channel) => <label key={channel.id}><span>#{channel.name}</span><select value={channelNotificationModes[channel.id] ?? "mentions"} onChange={(event) => setChannelNotificationModes((current) => ({ ...current, [channel.id]: event.target.value as "all" | "mentions" | "none" }))}><option value="all">すべて</option><option value="mentions">メンションのみ</option><option value="none">通知なし</option></select></label>)}
            </div>
            {error && <p className="community-error" role="alert">{error}</p>}
            <footer><button type="button" onClick={() => setShowCommunityNotifications(false)}>キャンセル</button><button type="button" className="community-modal__primary" onClick={saveCommunityNotifications} disabled={isPending}>{isPending ? "保存中…" : "保存"}</button></footer>
          </section>
        </div>
      )}
      {showGameManager && activeCommunity && <CommunityGameManager communityId={activeCommunity.id} onClose={() => setShowGameManager(false)} />}

      {showCreateCommunity && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-create-title"
          >
            <header>
              <div>
                <span>NEW COMMUNITY</span>
                <h2 id="community-create-title">コミュニティを作成</h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setShowCreateCommunity(false)}
              >
                ×
              </button>
            </header>
            <p>
              新しいコミュニティには「一般」チャンネルが自動で作成されます。
              コミュニティは参加者・ルール・話題の空間です。公開原本の保存先は作成後に運営センターの「保存・配信」で選べます。
            </p>
            <ol className="community-create-steps" aria-label="作成手順">
              <li>基本情報</li>
              <li>公開設定</li>
              <li>プレビュー</li>
            </ol>
            <label className="community-image-picker">
              <span>コミュニティ画像</span>
              <span className="community-image-picker__row">
                <span className="community-image-picker__preview">
                  {communityImageUrl ? (
                    <img
                      src={communityImageUrl}
                      alt="選択中のコミュニティ画像"
                    />
                  ) : (
                    initials(communityName || "C").slice(0, 1)
                  )}
                </span>
                <span className="community-image-picker__action">
                  {isPreparingCommunityImage ? "処理中…" : "画像を選ぶ"}
                  <small>8MBまで・WebPへ自動最適化</small>
                </span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={selectCommunityImage}
                disabled={isPreparingCommunityImage}
              />
            </label>
            <label>
              <span>カテゴリ</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {communityCategoryOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              <span>コミュニティ名</span>
              <input
                value={communityName}
                onChange={(event) => setCommunityName(event.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              <span>説明</span>
              <textarea
                value={communityDescription}
                onChange={(event) =>
                  setCommunityDescription(event.target.value)
                }
                maxLength={2000}
              />
            </label>
            <fieldset className="community-visibility-options">
              <legend>公開範囲</legend>
              {([
                ["public", "公開", "誰でもすぐ参加できます"],
                ["approval", "承認制", "参加には管理者の承認が必要です"],
                ["private", "招待制", "招待された人だけ参加できます"],
              ] as const).map(([value, label, help]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="community-visibility"
                    value={value}
                    checked={communityVisibility === value}
                    onChange={() => setCommunityVisibility(value)}
                  />
                  <span><strong>{label}</strong><small>{help}</small></span>
                </label>
              ))}
            </fieldset>
            <section className="community-create-preview" aria-label="作成プレビュー">
              <span className="community-image-picker__preview">
                {communityImageUrl ? <img src={communityImageUrl} alt="" /> : initials(communityName || "C").slice(0, 1)}
              </span>
              <div>
                <small>{category}・{communityVisibility === "public" ? "公開" : communityVisibility === "approval" ? "承認制" : "招待制"}</small>
                <strong>{communityName.trim() || "コミュニティ名"}</strong>
                <p>{communityDescription.trim() || "コミュニティの説明がここに表示されます。"}</p>
              </div>
            </section>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                onClick={() => setShowCreateCommunity(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="community-modal__primary"
                onClick={createCommunity}
                disabled={
                  isPending ||
                  isPreparingCommunityImage ||
                  !communityName.trim() ||
                  !communityDescription.trim()
                }
              >
                {isPending ? "作成中…" : "コミュニティを作成"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {showGuideProposalEditor && activeCommunity && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal community-guide-proposal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-proposal-title"
          >
            <header>
              <div>
                <span>EDIT PROPOSAL</span>
                <h2 id="guide-proposal-title">
                  {guideProposalPageId
                    ? `${knowledgeLabel}の変更を提案`
                    : `新しい${knowledgeLabel}ページを提案`}
                </h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setShowGuideProposalEditor(false)}
              >
                ×
              </button>
            </header>
            <p>
              内容はすぐ公開されず、コミュニティ内のレビューと承認を経て共同ページへ反映されます。
            </p>
            <label>
              <span>提案タイトル</span>
              <input
                value={guideProposalTitle}
                onChange={(event) => setGuideProposalTitle(event.target.value)}
                maxLength={120}
                placeholder="変更内容を短く説明"
              />
            </label>
            <label>
              <span>{knowledgeLabel}ページ名</span>
              <input
                value={guideProposedTitle}
                onChange={(event) => setGuideProposedTitle(event.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              <span>ディレクトリ</span>
              <select
                value={guideProposedDirectoryId}
                onChange={(event) =>
                  setGuideProposedDirectoryId(event.target.value)
                }
              >
                <option value="">トップ</option>
                {activeGuideDirectories.map((directory) => (
                  <option key={directory.id} value={directory.id}>
                    {"　".repeat(
                      guideDirectoryDepth(directory, activeGuideDirectories),
                    )}
                    {directory.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>変更の概要</span>
              <textarea
                value={guideProposalSummary}
                onChange={(event) =>
                  setGuideProposalSummary(event.target.value)
                }
                maxLength={500}
                placeholder="なぜこの変更が必要か、確認してほしい点"
              />
            </label>
            <label>
              <span>提案するページ本文</span>
              <textarea
                className="community-guide-proposal-modal__body"
                value={guideProposedBody}
                onChange={(event) => setGuideProposedBody(event.target.value)}
                maxLength={30000}
                placeholder="見出しは ##、手順は 1. の形式で入力できます"
              />
            </label>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                onClick={() => setShowGuideProposalEditor(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="community-modal__primary"
                onClick={submitGuideProposal}
                disabled={
                  isPending ||
                  !guideProposalTitle.trim() ||
                  !guideProposedTitle.trim() ||
                  !guideProposalSummary.trim() ||
                  !guideProposedBody.trim()
                }
              >
                {isPending ? "作成中…" : "編集提案を作成"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {showCommunityOperations && activeCommunity && <CommunityOperationsCenter communityId={activeCommunity.id} communityName={activeCommunity.name} open onClose={() => setShowCommunityOperations(false)} />}
      {appealCommunityId && <CommunityAppealForm key={appealCommunityId} communityId={appealCommunityId} onClose={()=>setAppealCommunityId(null)} />}

      {showEditCommunity && activeCommunity && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-edit-title"
          >
            <header>
              <div>
                <span>COMMUNITY SETTINGS</span>
                <h2 id="community-edit-title">コミュニティを編集</h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setShowEditCommunity(false)}
              >
                ×
              </button>
            </header>
            <p>
              コミュニティの画像、名前、カテゴリ、説明をまとめて更新できます。
            </p>
            <a className="community-game-link-action" href={hubSurfacePath(surface, `/games/new?community=${encodeURIComponent(activeCommunity.id)}`)}>
              <span><strong>ゲーム作品を追加・紐付け</strong><small>攻略を作品単位の公開ハブへ整理する</small></span><i aria-hidden="true">→</i>
            </a>
            <label className="community-image-picker">
              <span>コミュニティ画像</span>
              <span className="community-image-picker__row">
                <span className="community-image-picker__preview">
                  {communityImagesById.get(activeCommunity.id) ? (
                    <img
                      src={communityImagesById.get(activeCommunity.id)}
                      alt="現在のコミュニティ画像"
                    />
                  ) : (
                    initials(activeCommunity.name).slice(0, 1)
                  )}
                </span>
                <span className="community-image-picker__action">
                  {isPreparingCommunityImage ? "処理中…" : "画像を変更"}
                  <small>8MBまで・WebPへ自動最適化</small>
                </span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={updateActiveCommunityImage}
                disabled={isPreparingCommunityImage}
              />
            </label>
            <label>
              <span>コミュニティ名</span>
              <input
                value={editCommunityName}
                onChange={(event) => setEditCommunityName(event.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              <span>カテゴリ</span>
              <select
                value={editCommunityCategory}
                onChange={(event) =>
                  setEditCommunityCategory(event.target.value)
                }
              >
                {communityCategoryOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              <span>公開範囲</span>
              <select value={editCommunityVisibility} onChange={(event) => setEditCommunityVisibility(event.target.value as "public" | "approval" | "private")}>
                <option value="public">公開（誰でも参加）</option>
                <option value="approval">承認制</option>
                <option value="private">招待制</option>
              </select>
            </label>
            <label>
              <span>共同ページの表示名</span>
              <input
                value={editKnowledgeLabel}
                onChange={(event) => setEditKnowledgeLabel(event.target.value)}
                maxLength={40}
                placeholder="攻略、制作Wiki、資料庫など"
              />
            </label>
            <label>
              <span>共同ページの説明</span>
              <input
                value={editKnowledgeDescription}
                onChange={(event) =>
                  setEditKnowledgeDescription(event.target.value)
                }
                maxLength={160}
                placeholder="ここに整理する情報の説明"
              />
            </label>
            <label>
              <span>説明</span>
              <textarea
                value={editCommunityDescription}
                onChange={(event) =>
                  setEditCommunityDescription(event.target.value)
                }
                maxLength={2000}
              />
            </label>
            <section
              className="community-token-settings-summary"
              aria-label="コミュニティトークン設定"
            >
              <header>
                <span>
                  <strong>コミュニティトークン</strong>
                  <small>
                    {activeTokens.length
                      ? `${activeTokens.length}種類登録済み`
                      : "未登録"}
                  </small>
                </span>
                <span>
                  <button
                    type="button"
                    onClick={refreshTokenHoldings}
                    disabled={!activeTokens.length || isRefreshingHoldings}
                  >
                    {isRefreshingHoldings ? "更新中…" : "保有量を更新"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setShowEditCommunity(false);
                      setShowAddToken(true);
                    }}
                  >
                    トークンを追加
                  </button>
                </span>
              </header>
              {activeTokens.length > 0 && (
                <p>{activeTokens.map((token) => token.symbol).join(" · ")}</p>
              )}
              {holdingError && (
                <p className="community-error" role="alert">
                  {holdingError}
                </p>
              )}
            </section>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setShowEditCommunity(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className="community-modal__primary"
                onClick={() => saveCommunityDetails()}
                disabled={
                  isPending ||
                  isPreparingCommunityImage ||
                  !editCommunityName.trim() ||
                  !editCommunityDescription.trim() ||
                  !editKnowledgeLabel.trim() ||
                  !editKnowledgeDescription.trim()
                }
              >
                {isPending ? "保存中…" : "変更を保存"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showVisibilityConfirmation && activeCommunity && (
        <div className="community-modal-backdrop" role="presentation">
          <section
            className="community-modal community-member-action-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="community-visibility-confirm-title"
            aria-describedby="community-visibility-confirm-description"
          >
            <header>
              <div>
                <span>PUBLIC ACCESS</span>
                <h2 id="community-visibility-confirm-title">
                  公開範囲を変更しますか？
                </h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setShowVisibilityConfirmation(false)}
              >
                ×
              </button>
            </header>
            <div
              id="community-visibility-confirm-description"
              className="community-member-action-dialog__target"
            >
              <strong>{activeCommunity.name}</strong>
              <span>
                {activeCommunity.visibility === "private"
                  ? "招待制"
                  : activeCommunity.visibility === "approval"
                    ? "承認制"
                    : "公開"}
                {" → "}
                {editCommunityVisibility === "private"
                  ? "招待制"
                  : editCommunityVisibility === "approval"
                    ? "承認制"
                    : "公開"}
              </span>
              <small>
                公開では誰でも参加できます。承認制では参加申請が必要になり、招待制では招待された人だけが参加できます。
              </small>
            </div>
            {error && (
              <p className="community-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                onClick={() => setShowVisibilityConfirmation(false)}
              >
                戻る
              </button>
              <button
                type="button"
                className="community-modal__primary"
                disabled={isPending}
                onClick={() => saveCommunityDetails(true)}
              >
                {isPending ? "変更中…" : "公開範囲を変更"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
