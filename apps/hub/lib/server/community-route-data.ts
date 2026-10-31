import {completeCommunityJoin,CommunityJoinError} from '@/lib/server/community-join';
import {joinQuery,readJoinInput} from '@/lib/server/community-join-route';
import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { mutateCommunityGuideProposal } from "@/lib/server/community-guide-review";
import { requireCommunityGuideAccess } from "@/lib/server/community-guide-access";
import { createCommunityGuideProposal as createD1CommunityGuideProposal } from "@/lib/server/community-guide-proposals";
import {
  createCommunity,
  createCommunityChannel,
  createCommunityChannelMessage,
  createCommunityGovernanceProposal,
  createCommunityToken,
  deleteCommunityChannel,
  deleteCommunityChannelMessage,
  getCommunities,
  getCommunityChannelMessages,
  getCommunityChannels,
  getCommunityGuideDirectories,
  getCommunityGuidePages,
  getCommunityGuideProposals,
  getCommunityGuideReviews,
  getCommunityGovernanceProposals,
  getCommunityGovernanceVotes,
  getCommunityMemberships,
  getCommunityTokens,
  markCommunityChannelRead,
  manageCommunityMember,
  reportCommunityChannelMessage,
  setCommunityChannelMessagePinned,
  setCommunityChannelMessageWorkflow,
  toggleCommunityChannelReaction,
  toggleCommunityMembership,
  updateCommunityChannel,
  updateCommunity,
  updateCommunityChannelMessage,
  updateCommunityGovernanceSettings,
} from "@/lib/mock-data";
import {
  createD1CommunityChannel,
  createD1CommunityChannelMessage,
  deleteD1CommunityChannel,
  deleteD1CommunityChannelMessage,
  listD1CommunityChannelMessages,
  listD1CommunityChannels,
  reportD1CommunityChannelMessage,
  setD1CommunityChannelMessagePinned,
  setD1CommunityChannelMessageWorkflow,
  toggleD1CommunityChannelReaction,
  updateD1CommunityChannel,
  updateD1CommunityChannelMessage,
} from "@/lib/server/d1-community-channels";
import {
  castD1CommunityGovernanceVote,
  createD1CommunityGovernanceProposal,
  listD1CommunityGovernanceProposals,
  updateD1CommunityGovernanceProposalLifecycle,
  updateD1CommunityGovernanceSettings,
} from "@/lib/server/d1-community-governance";
import {
  createD1Community,
  manageD1CommunityMember,
  toggleD1CommunityMembership,
  type CommunityVisibility,
} from "@/lib/server/d1-community-management";
import { getHubD1, getOptionalHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getHubMedia } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile, requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { releaseHubStorageObject } from "@/lib/server/hub-storage-usage";
import {
  communityImageObjectKeyFromDeliveryUrl,
  communityImageVersionFromDeliveryUrl,
  storeCommunityImage,
} from "@/lib/server/community-image-storage";

export async function getCommunitiesRouteData(request: Request) {
  const database = getHubD1();
  const viewer = await getOptionalHubViewerProfile(request, database);
  const communities = viewer
    ? await database.prepare(`SELECT id, slug, name, description, category,
          image_url AS imageUrl, visibility, owner_profile_id AS ownerProfileId,
          knowledge_label AS knowledgeLabel,
          knowledge_description AS knowledgeDescription,
          created_at AS createdAt
          FROM communities
          WHERE lifecycle_status = 'active'
            AND (
              visibility IN ('public', 'approval')
              OR EXISTS (
                SELECT 1 FROM community_memberships membership
                WHERE membership.community_id = communities.id
                  AND membership.profile_id = ?
                  AND membership.status <> 'banned'
              )
            )
          ORDER BY created_at DESC`)
          .bind(viewer.id)
          .all()
      : await database.prepare(`SELECT id, slug, name, description, category,
          image_url AS imageUrl, visibility, owner_profile_id AS ownerProfileId,
          knowledge_label AS knowledgeLabel,
          knowledge_description AS knowledgeDescription,
          created_at AS createdAt
          FROM communities
          WHERE lifecycle_status = 'active' AND visibility = 'public'
          ORDER BY created_at DESC`)
          .all();
  const memberships = viewer
    ? await database.prepare(`SELECT community_id AS communityId,
          profile_id AS profileId, role, status, joined_at AS joinedAt
          FROM community_memberships WHERE profile_id = ?`)
        .bind(viewer.id)
        .all()
    : { results: [] };
  return {
    communities: communities.results,
    memberships: memberships.results,
  };
}

export async function createCommunityRouteData(request: Request, input: {
  name: string;
  description: string;
  category: string;
  imageUrl?: string;
  visibility?: CommunityVisibility;
}) {
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  return createCommunityForViewer(database, actor, input);
}

/** viewerを外から渡す版——desktop assertionのクライアントAPIからも同じ作成経路を通す。 */
export async function createCommunityForViewer(database: D1Database, actor: Profile, input: {
  name: string;
  description: string;
  category: string;
  imageUrl?: string;
  visibility?: CommunityVisibility;
}) {
  const id = `community-${crypto.randomUUID()}`;
  const bucket = input.imageUrl ? getHubMedia() : null;
  const storedImage = bucket && input.imageUrl
    ? await storeCommunityImage(bucket, id, input.imageUrl, { database, profileId: actor.id })
    : null;
  try {
    const community = await createD1Community(database, actor, {
      id,
      ...input,
      imageUrl: storedImage?.imageUrl,
      visibility: input.visibility ?? "public",
    });
    return { community };
  } catch (error) {
    if (bucket && storedImage) {
      await bucket.delete(storedImage.objectKey).catch(() => undefined);
      await releaseHubStorageObject(database, "community_image", storedImage.version).catch(() => undefined);
    }
    throw error;
  }
}

export async function updateCommunityRouteData(
  request: Request,
  input: {
    communityId: string;
    name?: string;
    description?: string;
    category?: string;
    visibility?: CommunityVisibility;
    knowledgeLabel?: string;
    knowledgeDescription?: string;
    imageUrl?: string;
    operationId: string;
    note?: string;
  },
) {
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
    const community = await database
      .prepare(
        `SELECT owner_profile_id AS ownerProfileId, image_url AS imageUrl,
         name, description, category, visibility,
         knowledge_label AS knowledgeLabel,
         knowledge_description AS knowledgeDescription
         FROM communities WHERE id = ? LIMIT 1`,
      )
      .bind(input.communityId)
      .first<{
        ownerProfileId: string;
        imageUrl: string | null;
        name: string;
        description: string;
        category: string;
        visibility: CommunityVisibility;
        knowledgeLabel: string | null;
        knowledgeDescription: string | null;
      }>();
    if (!community) throw new Error("コミュニティが見つかりません。");
    if (community.ownerProfileId !== actor.id) {
      throw new Error("コミュニティを編集できるのはオーナーだけです。");
    }
    const existing = await database.prepare(`SELECT id, action, created_at AS confirmedAt
      FROM community_audit_log WHERE id = ? AND community_id = ? LIMIT 1`)
      .bind(input.operationId, input.communityId)
      .first<{ id: string; action: string; confirmedAt: string }>();
    if (existing) {
      if (existing.action !== "community_settings_updated") {
        throw new Error("操作IDが別の操作で使用されています。");
      }
      return {
        community: { id: input.communityId, ...community },
        receipt: {
          auditId: existing.id,
          action: existing.action,
          targetId: input.communityId,
          confirmedAt: existing.confirmedAt,
          replayed: true,
        },
      };
    }
    const next = {
      name: input.name ?? community.name,
      description: input.description ?? community.description,
      category: input.category ?? community.category,
      visibility: input.visibility ?? community.visibility,
      knowledgeLabel: input.knowledgeLabel ?? community.knowledgeLabel,
      knowledgeDescription:
        input.knowledgeDescription ?? community.knowledgeDescription,
    };
    const changedFields = (
      [
        "name",
        "description",
        "category",
        "visibility",
        "knowledgeLabel",
        "knowledgeDescription",
      ] as const
    ).filter((field) => next[field] !== community[field]);
    if (input.imageUrl === undefined && changedFields.length === 0) {
      throw new Error("変更内容がありません。");
    }
    if (
      next.visibility !== community.visibility &&
      (!input.note || input.note.length < 5)
    ) {
      throw new Error("公開範囲変更の確認内容が不足しています。");
    }
    const bucket = input.imageUrl === undefined ? null : getHubMedia();
    const storedImage = bucket
      ? await storeCommunityImage(bucket, input.communityId, input.imageUrl, { database, profileId: actor.id })
      : null;
    const now = new Date().toISOString();
    try {
      await database.batch([
        database.prepare(
          `UPDATE communities SET name = ?, description = ?, category = ?,
           visibility = ?, knowledge_label = ?, knowledge_description = ?,
           image_url = COALESCE(?, image_url), updated_at = ? WHERE id = ?`,
        ).bind(
          next.name,
          next.description,
          next.category,
          next.visibility,
          next.knowledgeLabel,
          next.knowledgeDescription,
          storedImage?.imageUrl ?? null,
          now,
          input.communityId,
        ),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at)
          VALUES (?, ?, ?, 'community_settings_updated', ?, ?)`)
          .bind(input.operationId, input.communityId, actor.id, JSON.stringify({
            note: input.note ?? "",
            targetId: input.communityId,
            targetLabel: `コミュニティ「${community.name}」`,
            changedFields: [
              ...changedFields,
              ...(storedImage ? ["imageUrl"] : []),
            ],
            before: {
              name: community.name,
              category: community.category,
              visibility: community.visibility,
            },
            after: {
              name: next.name,
              category: next.category,
              visibility: next.visibility,
            },
          }), now),
      ]);
    } catch (error) {
      if (bucket && storedImage) {
        await bucket.delete(storedImage.objectKey).catch(() => undefined);
        await releaseHubStorageObject(database, "community_image", storedImage.version).catch(() => undefined);
      }
      throw error;
    }
    const previousObjectKey =
      communityImageObjectKeyFromDeliveryUrl(community.imageUrl);
    if (bucket && previousObjectKey) {
      await bucket.delete(previousObjectKey).catch(() => undefined);
      const previousVersion = communityImageVersionFromDeliveryUrl(community.imageUrl);
      if (previousVersion) await releaseHubStorageObject(database, "community_image", previousVersion).catch(() => undefined);
    }
  return {
      community: {
        id: input.communityId,
        ...next,
        imageUrl: storedImage?.imageUrl ?? community.imageUrl,
      },
      receipt: {
        auditId: input.operationId,
        action: "community_settings_updated",
        targetId: input.communityId,
        confirmedAt: now,
        replayed: false,
      },
  };
}

export async function getCommunityGuidesRouteData(communityId: string, viewer: Profile | null = null, database = getOptionalHubD1()) {
  if (database) {
    await requireCommunityGuideAccess(database, communityId, viewer);
    const [directories, pages, proposals, reviews] = await Promise.all([
      database.prepare(`SELECT id, community_id AS communityId,
        parent_directory_id AS parentDirectoryId, slug, name, position,
        created_at AS createdAt
        FROM community_guide_directories WHERE community_id = ?
        ORDER BY parent_directory_id, position, created_at`).bind(communityId).all(),
      database.prepare(`SELECT id, community_id AS communityId,
        directory_id AS directoryId, slug, title, body, version,
        updated_by_profile_id AS updatedByProfileId,
        created_at AS createdAt, updated_at AS updatedAt
        FROM community_guide_pages WHERE community_id = ?
        ORDER BY updated_at DESC`).bind(communityId).all(),
      database.prepare(`SELECT id, community_id AS communityId,
        page_id AS pageId, proposed_directory_id AS proposedDirectoryId,
        author_profile_id AS authorProfileId, title,
        proposed_title AS proposedTitle, proposed_body AS proposedBody,
        summary, status, base_version AS baseVersion,
        created_at AS createdAt, updated_at AS updatedAt,
        merged_at AS mergedAt, merged_by_profile_id AS mergedByProfileId
        FROM community_guide_proposals WHERE community_id = ?
        ORDER BY updated_at DESC`).bind(communityId).all(),
      database.prepare(`SELECT id, proposal_id AS proposalId,
        author_profile_id AS authorProfileId, body, decision,
        created_at AS createdAt FROM community_guide_reviews
        WHERE proposal_id IN (
          SELECT id FROM community_guide_proposals WHERE community_id = ?
        ) ORDER BY created_at`).bind(communityId).all(),
    ]);
    return {
      directories: directories.results,
      pages: pages.results,
      proposals: proposals.results.map((proposal) => ({
        ...proposal,
        reviews: reviews.results.filter(
          (review) => review.proposalId === proposal.id,
        ),
      })),
    };
  }
  return {
    directories: getCommunityGuideDirectories(communityId),
    pages: getCommunityGuidePages(communityId),
    proposals: getCommunityGuideProposals(communityId).map((proposal) => ({
      ...proposal,
      reviews: getCommunityGuideReviews(proposal.id),
    })),
  };
}

export async function createCommunityGuideProposalRouteData(
  request: Request,
  input: {
    communityId: string;
    pageId?: string | null;
    proposedDirectoryId?: string | null;
    title: string;
    proposedTitle: string;
    proposedBody: string;
    summary: string;
    requestId?: string;
    baseVersion?: number;
  },
) {
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  return createD1CommunityGuideProposal(database, actor, input.communityId, input);
}

export async function reviewCommunityGuideProposalRouteData(request: Request, input: {
  communityId: string; proposalId: string; body: unknown; decision: unknown; requestId?: unknown; expectedUpdatedAt?: unknown;
}) {
  const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
  return mutateCommunityGuideProposal(database,actor,input.communityId,input.proposalId,input,true);
}
export async function updateCommunityGuideProposalStatusRouteData(request: Request, input: {
  communityId: string; proposalId: string; action: unknown; requestId?: unknown; expectedUpdatedAt?: unknown;
}) {
  const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
  return mutateCommunityGuideProposal(database,actor,input.communityId,input.proposalId,input);
}

export async function getCommunityGovernanceRouteData(request:Request,communityId:string,offset?:number){
 const database=getHubD1();
 const {getOptionalHubSessionProfile}=await import('./hub-session');
 const viewer=await getOptionalHubSessionProfile(request,database);
 const access=await import('./community-governance-access');
 return offset===undefined?access.readLegacyCommunityGovernance(database,communityId,viewer?.id??null):access.readCommunityGovernancePage(database,communityId,viewer?.id??null,offset);
}

export async function createCommunityGovernanceProposalRouteData(request:Request,communityId:string,payload:unknown){
 const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
 const {createCommunityGovernanceProposal}=await import('./community-governance-create');
 return createCommunityGovernanceProposal(database,actor,communityId,payload);
}

export async function castCommunityGovernanceVoteRouteData(request:Request,input:{communityId:string;proposalId:string;choice:'for'|'against'|'abstain';operationId?:unknown;snapshot?:unknown}){
  const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
  return castD1CommunityGovernanceVote(database,actor,input);
}

export async function updateCommunityGovernanceProposalLifecycleRouteData(request:Request,input:{communityId:string;proposalId:string;action:'start_voting'|'close_voting'|'execute'|'cancel';operationId?:unknown;snapshot?:unknown}){
  const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
  return updateD1CommunityGovernanceProposalLifecycle(database,actor,input);
}

export async function updateCommunityGovernanceSettingsRouteData(request:Request,input:{communityId:string}&Record<string,unknown>){
 const database=getHubD1(),actor=await requireHubSessionProfile(request,database),{communityId,...payload}=input;
 const {updateCommunityGovernanceSettings}=await import('./community-governance-access');
 return updateCommunityGovernanceSettings(database,actor,communityId,payload);
}

export async function toggleCommunityMembershipRouteData(request:Request,communityId:string){
  joinQuery(request);
  const database=getHubD1(),actor=await requireHubViewerProfile(request,database),payload=await readJoinInput(request);
  if(payload instanceof Response)throw new CommunityJoinError('入力が大きすぎます。',413);
  const body=payload as Record<string,unknown>;
  if(Object.keys(body).length!==1||typeof body.joined!=='boolean')throw new CommunityJoinError('参加状態を明示してください。',400);
  if(body.joined)return completeCommunityJoin(database,actor,communityId,{acceptedRules:true,answers:[]},{requireNoGuide:true});
  return toggleD1CommunityMembership(database,actor,communityId,false);
}

export async function getCommunityTokensRouteData(communityId: string) {
  const database = getOptionalHubD1();
  if (database) {
    const tokens = await database.prepare(`SELECT id,
      community_id AS communityId, name, symbol, network,
      contract_address AS contractAddress,
      created_by_profile_id AS createdByProfileId,
      created_at AS createdAt
      FROM community_tokens WHERE community_id = ?
      ORDER BY created_at DESC`).bind(communityId).all();
    return { tokens: tokens.results };
  }
  return { tokens: getCommunityTokens(communityId) };
}

export async function createCommunityTokenRouteData(
  request: Request,
  input: {
    communityId: string;
    name: string;
    symbol: string;
    network: string;
    contractAddress?: string;
  },
) {
  const database = getOptionalHubD1();
  if (database) {
    const actor = await requireHubSessionProfile(request, database);
    const membership = await database.prepare(`SELECT role, status
      FROM community_memberships
      WHERE community_id = ? AND profile_id = ? LIMIT 1`)
      .bind(input.communityId, actor.id)
      .first<{ role: string; status: string }>();
    if (
      !membership ||
      membership.status !== "active" ||
      !["owner", "moderator"].includes(membership.role)
    ) {
      throw new Error("コミュニティトークンを登録する権限がありません。");
    }
    const token = {
      id: crypto.randomUUID(),
      communityId: input.communityId,
      name: input.name.trim(),
      symbol: input.symbol.trim().toUpperCase(),
      network: input.network.trim(),
      contractAddress: input.contractAddress?.trim() || null,
      createdByProfileId: actor.id,
      createdAt: new Date().toISOString(),
    };
    await database.prepare(`INSERT INTO community_tokens
      (id, community_id, name, symbol, network, contract_address,
       created_by_profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        token.id,
        token.communityId,
        token.name,
        token.symbol,
        token.network,
        token.contractAddress,
        token.createdByProfileId,
        token.createdAt,
      ).run();
    return { token };
  }
  return { token: createCommunityToken(input) };
}

export async function getCommunityChannelsRouteData(
  request: Request,
  communityId: string,
) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await getOptionalHubViewerProfile(request, database);
    return {
      channels: await listD1CommunityChannels(
        database,
        communityId,
        viewer?.id ?? null,
      ),
    };
  }
  return { channels: getCommunityChannels(communityId) };
}

export async function createCommunityChannelRouteData(
  request: Request,
  input: {
    communityId: string;
    name: string;
    description: string;
  },
) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return {
      channel: await createD1CommunityChannel(database, viewer, input),
    };
  }
  return { channel: createCommunityChannel(input) };
}

export async function updateCommunityChannelRouteData(
  request: Request,
  input: {
    communityId: string;
    channelId: string;
    name?: string;
    description?: string;
    direction?: "up" | "down";
  },
) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    const channel = await updateD1CommunityChannel(database, viewer, input);
    return {
      channel,
      channels: await listD1CommunityChannels(
        database,
        input.communityId,
        viewer.id,
      ),
    };
  }
  return {
    channel: updateCommunityChannel(input),
    channels: getCommunityChannels(input.communityId),
  };
}

export async function deleteCommunityChannelRouteData(
  request: Request,
  input: {
    communityId: string;
    channelId: string;
    operationId: string;
    note?: string;
  },
) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return deleteD1CommunityChannel(database, viewer, input);
  }
  return deleteCommunityChannel(input);
}

export async function getCommunityChannelMessagesRouteData(
  request: Request,
  communityId: string,
  channelId: string,
  options: { viewer?: Profile | null } = {},
) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = options.viewer === undefined ? await getOptionalHubViewerProfile(request, database) : options.viewer;
    return {
      messages: await listD1CommunityChannelMessages(
        database,
        communityId,
        channelId,
        viewer?.id ?? null,
      ),
    };
  }
  if (
    !getCommunityChannels(communityId).some(
      (channel) => channel.id === channelId,
    )
  ) {
    throw new Error("Channel does not exist in this community.");
  }
  return { messages: getCommunityChannelMessages(channelId) };
}

export async function createCommunityChannelMessageRouteData(
  request: Request,
  input: {
    communityId: string;
    channelId: string;
    body: string;
    replyToMessageId?: string | null;
    kind?: "chat" | "guide" | "question" | "party";
    imageIds?: string[];
    clientRequestId?: string;
  },
  beforeCreate?: (viewer: { id: string }) => void,
) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    beforeCreate?.(viewer);
    return {
      message: await createD1CommunityChannelMessage(database, viewer, {
        ...input,
        kind: input.kind ?? "chat",
      }),
    };
  }
  if (beforeCreate) throw new HubD1UnavailableError();
  if (input.clientRequestId) throw new Error("投稿の保存先を利用できません。時間をおいて再送してください。");
  return { message: createCommunityChannelMessage(input) };
}

export async function setCommunityChannelMessagePinnedRouteData(request: Request, input: {
  communityId: string;
  channelId: string;
  messageId: string;
  pinned: boolean;
}) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return { message: await setD1CommunityChannelMessagePinned(database, viewer, input) };
  }
  return { message: setCommunityChannelMessagePinned(input) };
}

export async function setCommunityChannelMessageWorkflowRouteData(request: Request, input: {
  communityId: string;
  channelId: string;
  messageId: string;
  workflowStatus: "open" | "resolved" | "closed";
}) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return { message: await setD1CommunityChannelMessageWorkflow(database, viewer, input) };
  }
  return { message: setCommunityChannelMessageWorkflow(input) };
}

export async function updateCommunityChannelMessageRouteData(request: Request, input: {
  communityId: string;
  channelId: string;
  messageId: string;
  body: string;
}) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return { message: await updateD1CommunityChannelMessage(database, viewer, input) };
  }
  return { message: updateCommunityChannelMessage(input) };
}

export async function deleteCommunityChannelMessageRouteData(request: Request, input: {
  communityId: string;
  channelId: string;
  messageId: string;
}) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return deleteD1CommunityChannelMessage(database, viewer, input);
  }
  return deleteCommunityChannelMessage(input);
}

export async function reportCommunityChannelMessageRouteData(request: Request, input: {
  communityId: string;
  channelId: string;
  messageId: string;
  reason: "spam" | "harassment" | "other";
}) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    const result = await reportD1CommunityChannelMessage(database, viewer, input);
    return {
      report: {
        id: result.reportId,
        communityId: input.communityId,
        channelId: input.channelId,
        messageId: input.messageId,
        reporterProfileId: viewer.id,
        reason: input.reason,
        status: "open" as const,
        createdAt: result.createdAt,
      },
      submitted: !result.duplicate,
    };
  }
  return reportCommunityChannelMessage(input);
}

export async function manageCommunityMemberRouteData(request: Request, input: {
  communityId: string;
  profileId: string;
  action: "promote" | "demote" | "mute" | "unmute" | "ban";
  operationId: string;
  note?: string;
}) {
  const database = getOptionalHubD1();
  if (database) {
    const actor = await requireHubViewerProfile(request, database);
    return { member: await manageD1CommunityMember(database, actor, input) };
  }
  return { member: manageCommunityMember(input) };
}

export async function toggleCommunityChannelReactionRouteData(request: Request, input: {
  communityId: string;
  channelId: string;
  messageId: string;
  emoji: "👍" | "❤️" | "🎉";
}) {
  const database = getOptionalHubD1();
  if (database) {
    const viewer = await requireHubViewerProfile(request, database);
    return toggleD1CommunityChannelReaction(database, viewer, input);
  }
  return toggleCommunityChannelReaction(input);
}

export function markCommunityChannelReadRouteData(input: {
  communityId: string;
  channelId: string;
  lastReadMessageId: string | null;
}) {
  return markCommunityChannelRead(input);
}
