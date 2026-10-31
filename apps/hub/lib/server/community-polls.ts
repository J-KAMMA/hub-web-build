import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import { listD1CommunityChannels, listD1CommunityChannelMessages } from "./d1-community-channels";

// Use the same message visibility rules as the conversation, including roles
// and blocked authors. The native reader can pass its already-filtered IDs.
export async function getCommunityPollOptions(database: D1Database, communityId: string, viewerId: string, messageIds?: string[]) {
  const ids = messageIds ?? (await Promise.all((await listD1CommunityChannels(database, communityId, viewerId))
    .map(channel => listD1CommunityChannelMessages(database, communityId, channel.id, viewerId))))
    .flat().map(message => message.id);
  if (!ids.length) return [];
  const chunks = Array.from({ length: Math.ceil(ids.length / 75) }, (_, index) => ids.slice(index * 75, (index + 1) * 75));
  const results = await Promise.all(chunks.map(chunk => database.prepare(`SELECT p.message_id AS messageId, p.closes_at AS closesAt, p.multiple_choice AS multipleChoice,
    o.id AS optionId, o.label, o.position, count(v.profile_id) AS voteCount,
    max(CASE WHEN v.profile_id = ? THEN 1 ELSE 0 END) AS voted
    FROM community_message_polls p JOIN community_message_poll_options o ON o.message_id = p.message_id
    JOIN community_channel_messages m ON m.id = p.message_id JOIN community_channels c ON c.id = m.channel_id
    LEFT JOIN community_message_poll_votes v ON v.option_id = o.id
    WHERE c.community_id = ? AND m.id IN (${chunk.map(() => "?").join(",")})
    GROUP BY p.message_id, o.id ORDER BY p.message_id, o.position`).bind(viewerId, communityId, ...chunk).all()));
  return results.flatMap(result => result.results);
}
