import 'server-only';
import { normalizeVideoSource, parseExternalVideoInput } from '@/lib/video-source';
import { parseVideoContextInput } from '@/lib/video-context';
import { normalizeMusicSource, parseMusicWorkInput } from '@/lib/music-source';
import { createD1ExternalVideo, ExternalVideoAlreadyExistsError } from './d1-videos';
import { createD1MusicWork } from './d1-music';
import { lookupExternalVideoMetadata, type ExternalVideoMetadata } from './video-metadata';
import { lookupExternalMusicMetadata, type ExternalMusicMetadata } from './music-metadata';
import { validateYouTubeMusicVideo, YouTubeMusicRejectedError, YouTubeMusicValidationUnavailableError } from './youtube-music-validation';
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from './desktop-hub-auth';
import { getHubD1 } from './hub-d1';
import { HubSuspendedError } from './hub-session';
import { hasSameOrigin } from './hub-auth-route';
import { ExternalMusicWorkNotFoundError, reportD1ExternalMusicWork } from './d1-external-music-reports';

type Operation = 'video_metadata' | 'video_register' | 'music_metadata' | 'music_register' | 'music_report';
class InvalidExternalMediaInput extends Error {}
const invalid = (): never => { throw new InvalidExternalMediaInput(); };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
const wellFormed = (value: string) => !/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const bounded = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && wellFormed(value) && (empty || !!value.trim());
const text = (value: unknown, max: number, empty = false) => { if (!bounded(value, max, empty)) return invalid(); return value; };
const keys = (body: Record<string, unknown>, allowed: readonly string[]) => { if (Object.keys(body).some(key => !allowed.includes(key))) return invalid(); };

async function readInput(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid();
  const reader = request.body?.getReader(); if (!reader) return invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true }); let value = '', size = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read(); if (done) break;
      size += chunk.byteLength;
      if (size > 64 * 1024) { await reader.cancel().catch(() => {}); return invalid(); }
      value += decoder.decode(chunk, { stream: true });
    }
    value += decoder.decode();
  } catch { await reader.cancel().catch(() => {}); return invalid(); }
  finally { reader.releaseLock(); }
  let body: unknown; try { body = JSON.parse(value); } catch { return invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  return body as Record<string, unknown>;
}

function videoInput(body: Record<string, unknown>) {
  keys(body, ['sourceUrl', 'title', 'channel', 'category', 'purpose', 'topic', 'relatedHubpediaSlug']);
  for (const [key, max] of [['sourceUrl', 2048], ['title', 240], ['channel', 120], ['category', 80], ['topic', 80]] as const) text(body[key], max);
  if (body.relatedHubpediaSlug !== undefined) text(body.relatedHubpediaSlug, 160, true);
  try {
    const parsed = { ...parseExternalVideoInput(body), ...parseVideoContextInput(body) };
    for (const [value, max] of [[parsed.source.sourceUrl, 2048], [parsed.title, 240], [parsed.channel, 120], [parsed.category, 80], [parsed.topic, 80]] as const) text(value, max);
    return parsed;
  } catch { return invalid(); }
}

function musicInput(body: Record<string, unknown>) {
  keys(body, ['title', 'artist', 'description', 'genre', 'year', 'tags', 'serviceUrls']);
  for (const [key, max] of [['title', 180], ['artist', 120], ['description', 500], ['genre', 60]] as const) text(body[key], max);
  if (typeof body.year !== 'number' || !Number.isInteger(body.year) || body.year < 1000 || body.year > new Date().getFullYear() + 1) return invalid();
  if (!Array.isArray(body.serviceUrls) || body.serviceUrls.length < 1 || body.serviceUrls.length > 6) return invalid();
  body.serviceUrls.forEach(value => text(value, 2048));
  if (body.tags !== undefined) { if (!Array.isArray(body.tags) || body.tags.length > 12) return invalid(); body.tags.forEach(value => text(value, 40)); }
  try {
    const parsed = parseMusicWorkInput(body);
    for (const [value, max] of [[parsed.title, 180], [parsed.artist, 120], [parsed.description, 500], [parsed.genre, 60]] as const) text(value, max);
    parsed.tags.forEach(value => text(value, 40));
    parsed.services.forEach(service => { text(service.url, 2048); if (service.embedUrl !== undefined) text(service.embedUrl, 2048); });
    return parsed;
  } catch { return invalid(); }
}

const metadataText = (value: unknown, max: number) => value === undefined || bounded(value, max) && value.normalize('NFKC').trim().length <= max && !/\p{Cc}/u.test(value);
const thumbnail = (value: unknown) => {
  if (value === undefined) return true;
  if (!bounded(value, 2048)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port; } catch { return false; }
};
function videoMetadata(value: ExternalVideoMetadata, source: ReturnType<typeof normalizeVideoSource>): ExternalVideoMetadata {
  if (value.sourceUrl !== source.sourceUrl || value.provider !== source.provider || !metadataText(value.title, 240) || !metadataText(value.channel, 120) || !thumbnail(value.thumbnailUrl)
    || value.broadcastStatus !== undefined && !['video', 'live', 'upcoming', 'archive'].includes(value.broadcastStatus)) throw new Error('metadata_invalid');
  return { sourceUrl: value.sourceUrl, provider: value.provider, title: value.title, channel: value.channel, thumbnailUrl: value.thumbnailUrl, broadcastStatus: value.broadcastStatus };
}
function musicMetadata(value: ExternalMusicMetadata, source: ReturnType<typeof normalizeMusicSource>): ExternalMusicMetadata {
  if (value.sourceUrl !== source.url || value.provider !== source.provider || value.providerLabel !== source.label || !metadataText(value.title, 180) || !metadataText(value.artist, 120) || !thumbnail(value.thumbnailUrl)) throw new Error('metadata_invalid');
  return { sourceUrl: value.sourceUrl, provider: value.provider, providerLabel: value.providerLabel, title: value.title, artist: value.artist, thumbnailUrl: value.thumbnailUrl };
}

export async function clientExternalMedia(request: Request, operation: Operation) {
  try {
    if (new URL(request.url).search) return json({ error: 'invalid_request' }, 400);
    if (request.headers.has('origin') && !hasSameOrigin(request)) return json({ error: 'invalid_request_origin' }, 403);
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database), body = await readInput(request);
    if (operation === 'video_metadata' || operation === 'music_metadata') {
      keys(body, ['sourceUrl']); const requestedSourceUrl = text(body.sourceUrl, 2048).trim();
      if (/\p{Cc}/u.test(requestedSourceUrl)) return invalid();
      if (operation === 'video_metadata') {
        let source; try { source = normalizeVideoSource(requestedSourceUrl); text(source.sourceUrl, 2048); } catch { return invalid(); }
        return json({ viewerId: viewer.id, requestedSourceUrl, metadata: videoMetadata(await lookupExternalVideoMetadata(source.sourceUrl), source) });
      }
      let source; try { source = normalizeMusicSource(requestedSourceUrl); text(source.url, 2048); } catch { return invalid(); }
      return json({ viewerId: viewer.id, requestedSourceUrl, metadata: musicMetadata(await lookupExternalMusicMetadata(requestedSourceUrl), source) });
    }
    if (operation === 'video_register') {
      const input = videoInput(body);
      if (input.source.storedProvider === 'youtube') return json({ error: 'youtube_video_registration_closed' }, 410);
      const metadata = videoMetadata(await lookupExternalVideoMetadata(input.source.sourceUrl), input.source);
      return json({ viewerId: viewer.id, video: await createD1ExternalVideo(database, viewer, { ...input, source: { ...input.source, thumbnailUrl: metadata.thumbnailUrl ?? input.source.thumbnailUrl } }) }, 201);
    }
    if (operation === 'music_register') {
      const input = musicInput(body);
      for (const service of input.services) if (service.provider === 'youtube') await validateYouTubeMusicVideo(service.url);
      return json({ viewerId: viewer.id, work: await createD1MusicWork(database, viewer, input) }, 201);
    }
    keys(body, ['workId', 'reason', 'details']);
    const workId = text(body.workId, 160).trim(), details = body.details === undefined ? '' : text(body.details, 1000, true).trim();
    if (typeof body.reason !== 'string' || !['not_music', 'duplicate', 'wrong_metadata', 'unavailable', 'rights', 'other'].includes(body.reason)) return invalid();
    await reportD1ExternalMusicWork(database, viewer.id, workId, body.reason, details);
    return json({ viewerId: viewer.id, workId, reported: true });
  } catch (error) {
    if (error instanceof InvalidExternalMediaInput) return json({ error: 'invalid_request' }, 400);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: 'desktop_authentication_failed' }, 401);
    if (error instanceof HubSuspendedError) return json({ error: 'suspended' }, 403);
    if (error instanceof ExternalMusicWorkNotFoundError) return json({ error: 'not_found' }, 404);
    if (error instanceof ExternalVideoAlreadyExistsError) return json({ error: 'video_exists' }, 409);
    if (error instanceof YouTubeMusicRejectedError) return json({ error: 'youtube_music_rejected' }, 422);
    if (error instanceof YouTubeMusicValidationUnavailableError) return json({ error: 'youtube_music_validation_unavailable' }, 503);
    return json({ error: 'external_media_unavailable' }, 503);
  }
}
