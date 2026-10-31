import 'server-only';
import {getHubD1} from './hub-d1';
import {DesktopHubAuthenticationError, requireDesktopHubProfile} from './desktop-hub-auth';
import {HubSuspendedError} from './hub-session';
import {hasSameOrigin} from './hub-auth-route';
import type {CommunityNotificationPreferences} from './d1-community-management';

type Operation = 'get' | 'update' | 'read-all';
type ChannelPreference = {channelId: string; name: string; mode: 'all' | 'mentions' | 'none'; mutedUntil: string | null};
const preferenceKeys = ['mentions', 'replies', 'guideUpdates', 'governance', 'membership'] as const;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store', Vary: 'Authorization'}});
class InvalidInput extends Error {}
class Denied extends Error {}
const invalid = (): never => { throw new InvalidInput(); };

export async function readCommunityNotificationInput(request: Request, empty = false): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) return empty ? {} : invalid();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let text = '', bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) return invalid();
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
  } catch { await reader.cancel().catch(() => {}); return invalid(); }
  finally { reader.releaseLock(); }
  if (empty && !text) return {};
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  return body as Record<string, unknown>;
}

function preferences(row: Record<string, unknown>): CommunityNotificationPreferences {
  return Object.fromEntries(preferenceKeys.map(key => {
    const value = row[key];
    if (value !== 0 && value !== 1) throw new Error('Invalid stored preferences');
    return [key, value === 1];
  })) as CommunityNotificationPreferences;
}

// Each guarded statement binds its viewer and community rather than trusting input ownership.
const visible = `c.archived_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM community_member_custom_roles member_role
  JOIN community_channel_permissions permission ON permission.role_id = member_role.role_id AND permission.channel_id = c.id
  WHERE member_role.community_id = c.community_id AND member_role.profile_id = ? AND permission.can_view = 0
)`;
const member = (muted = false) => `EXISTS (SELECT 1 FROM community_memberships m
  JOIN communities community ON community.id=m.community_id
  WHERE m.community_id = ? AND m.profile_id = ? AND m.status IN (${muted ? "'active','muted'" : "'active'"}) AND community.lifecycle_status='active')`;

/** A fixed Desktop route supplies the operation; its one assertion supplies the profile. */
export async function clientCommunityNotifications(request: Request, params: Promise<{communityId: string}>, operation: Operation) {
  try {
    const {communityId} = await params;
    if (!identifier(communityId) || new URL(request.url).search) return invalid();
    if (operation !== 'get' && request.headers.has('origin') && !hasSameOrigin(request)) return json({error: 'invalid_origin'}, 403);
    if (!request.headers.has('authorization')) throw new DesktopHubAuthenticationError();
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    if (operation === 'get') {
      const result = await database.batch([
        database.prepare(`SELECT coalesce(p.mentions,1) AS mentions,coalesce(p.replies,1) AS replies,
          coalesce(p.guide_updates,1) AS guideUpdates,coalesce(p.governance,1) AS governance,coalesce(p.membership,1) AS membership
          FROM community_memberships m JOIN communities community ON community.id=m.community_id
          LEFT JOIN community_notification_preferences p
            ON p.community_id=m.community_id AND p.profile_id=m.profile_id
          WHERE m.community_id=? AND m.profile_id=? AND m.status='active' AND community.lifecycle_status='active' LIMIT 1`).bind(communityId, viewer.id),
        database.prepare(`SELECT c.id AS channelId,CASE WHEN instr(c.name,char(0))=0 THEN c.name ELSE NULL END AS name,
          coalesce(p.mode,'mentions') AS mode,p.muted_until AS mutedUntil
          FROM community_channels c LEFT JOIN community_channel_notification_preferences p ON p.channel_id=c.id AND p.profile_id=?
          WHERE c.community_id=? AND ${member()} AND ${visible} ORDER BY c.position,c.created_at,c.id`)
          .bind(viewer.id, communityId, communityId, viewer.id, viewer.id),
      ]);
      if (result.some(item => !item.success)) throw new Error('Read unavailable');
      const row = result[0].results?.[0] as Record<string, unknown> | undefined;
      if (!row) throw new Denied();
      const channels = result[1].results as ChannelPreference[];
      // Legacy channel renames had no creation-width check. Preserve readable names without truncation.
      if (!Array.isArray(channels) || channels.some(item => !identifier(item.channelId) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 1000 || /[\u0000\uD800-\uDFFF]/u.test(item.name) || !['all','mentions','none'].includes(item.mode) || item.mutedUntil !== null && typeof item.mutedUntil !== 'string')) throw new Error('Invalid channel preferences');
      const payload = {viewerId: viewer.id, communityId, preferences: preferences(row), channels};
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 1048576) throw new Error('Channel preferences too large');
      return json(payload);
    }
    const body = await readCommunityNotificationInput(request, operation === 'read-all');
    const updatedAt = new Date().toISOString();
    if (operation === 'read-all') {
      if (Object.keys(body).length) return invalid();
      const result = await database.batch([
        database.prepare(`SELECT 1 AS allowed FROM community_memberships m JOIN communities community ON community.id=m.community_id
          WHERE m.community_id=? AND m.profile_id=? AND m.status IN ('active','muted') AND community.lifecycle_status='active' LIMIT 1`).bind(communityId, viewer.id),
        database.prepare(`INSERT INTO community_channel_read_states (channel_id,profile_id,last_read_message_id,updated_at)
          SELECT c.id,?,(SELECT message.id FROM community_channel_messages message WHERE message.channel_id=c.id
            ORDER BY message.created_at DESC,message.id DESC LIMIT 1),?
          FROM community_channels c WHERE c.community_id=? AND ${member(true)} AND ${visible}
          ON CONFLICT(channel_id,profile_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id,updated_at=excluded.updated_at`)
          .bind(viewer.id, updatedAt, communityId, communityId, viewer.id, viewer.id),
      ]);
      if (result.some(item => !item.success)) throw new Error('Read state unavailable');
      if (!result[0].results?.length) throw new Denied();
      return json({viewerId: viewer.id, communityId, read: true, updatedAt});
    }
    if (Object.keys(body).some(key => ![...preferenceKeys, 'channels'].includes(key)) || preferenceKeys.some(key => typeof body[key] !== 'boolean') || !Array.isArray(body.channels) || body.channels.length > 100) return invalid();
    const channels = body.channels as Array<Record<string, unknown>>;
    if (channels.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['channelId','mode'].includes(key)) || !identifier(item.channelId) || typeof item.mode !== 'string' || !['all','mentions','none'].includes(item.mode)) || new Set(channels.map(item => item.channelId)).size !== channels.length) return invalid();
    const channelIds = JSON.stringify(channels.map(item => item.channelId));
    // Gate every write on every requested channel, so a hidden/moved channel cannot partially save settings.
    const allowed = `${member()} AND NOT EXISTS (SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS (
      SELECT 1 FROM community_channels c WHERE c.id=requested.value AND c.community_id=? AND ${visible}))`;
    const guard = [communityId, viewer.id, channelIds, communityId, viewer.id];
    const result = await database.batch([
      database.prepare(`INSERT INTO community_notification_preferences (community_id,profile_id,mentions,replies,guide_updates,governance,membership,updated_at)
        SELECT ?,?,?,?,?,?,?,? WHERE ${allowed}
        ON CONFLICT(community_id,profile_id) DO UPDATE SET mentions=excluded.mentions,replies=excluded.replies,
          guide_updates=excluded.guide_updates,governance=excluded.governance,membership=excluded.membership,updated_at=excluded.updated_at`)
        .bind(communityId, viewer.id, ...preferenceKeys.map(key => Number(body[key])), updatedAt, ...guard),
      ...channels.map(item => database.prepare(`INSERT INTO community_channel_notification_preferences (channel_id,profile_id,mode,muted_until,updated_at)
        SELECT c.id,?,?,NULL,? FROM community_channels c WHERE c.id=? AND c.community_id=? AND ${allowed} AND ${visible}
        ON CONFLICT(channel_id,profile_id) DO UPDATE SET mode=excluded.mode,muted_until=NULL,updated_at=excluded.updated_at`)
        .bind(viewer.id, item.mode as string, updatedAt, item.channelId as string, communityId, ...guard, viewer.id)),
    ]);
    if (result.some(item => !item.success)) throw new Error('Save unavailable');
    if (result.some(item => item.meta.changes !== 1)) throw new Denied();
    return json({viewerId: viewer.id, communityId, preferences: Object.fromEntries(preferenceKeys.map(key => [key, body[key]]))});
  } catch (error) {
    if (error instanceof InvalidInput) return json({error: 'invalid_request'}, 400);
    if (error instanceof DesktopHubAuthenticationError) return json({error: 'desktop_authentication_failed'}, 401);
    if (error instanceof HubSuspendedError || error instanceof Denied) return json({error: 'forbidden'}, 403);
    return json({error: 'community_preferences_unavailable'}, 503);
  }
}
