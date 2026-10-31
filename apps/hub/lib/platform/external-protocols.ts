export type HubExternalProtocol = "activitypub" | "atproto";
export type HubProtocolDirection = "export" | "import" | "bidirectional";

type PublicFederationPost = {
  id: string;
  body: string;
  createdAt: string;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeMailHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function normalizeRemoteIdentifier(protocol: HubExternalProtocol, value: unknown) {
  if (typeof value !== "string") return null;
  const identifier = value.trim();
  if (identifier.length < 3 || identifier.length > 512) return null;
  if (protocol === "activitypub") {
    if (/^https:\/\/[^\s]+$/i.test(identifier)) return identifier;
    if (/^@[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{3,253}$/i.test(identifier)) return identifier.toLowerCase();
    return null;
  }
  if (/^did:(plc|web):[A-Za-z0-9._:%-]{3,480}$/i.test(identifier)) return identifier;
  if (/^[A-Za-z0-9][A-Za-z0-9.-]{1,251}\.[A-Za-z]{2,63}$/i.test(identifier)) return identifier.toLowerCase();
  return null;
}

/*
 * ActivityPub の actor / outbox は apps/federation だけが返す（DESIGN.md 0.2、8.0）。
 * Hub 内に第二の actor を持たない。公開鍵も inbox の経路も無い写しが食い違いの元だった。
 * ここでは Federation の actor が置かれる URL を一か所で決める。
 */
export function federationActorUrl(origin: string, handle: string) {
  return `${origin}/users/${encodeURIComponent(handle)}`;
}

export function federationOutboxUrl(origin: string, handle: string) {
  return `${federationActorUrl(origin, handle)}/outbox`;
}

export function buildRssFeed(origin: string, profile: {
  handle: string;
  displayName: string;
  bio: string;
}, posts: PublicFederationPost[]) {
  const profileUrl = `${origin}/profile/${encodeURIComponent(profile.handle)}`;
  const items = posts.map((post) => {
    const postUrl = `${origin}/posts/${encodeURIComponent(post.id)}`;
    return [
      "    <item>",
      `      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>`,
      `      <link>${escapeXml(postUrl)}</link>`,
      `      <title>${escapeXml(post.body.slice(0, 80) || `${profile.displayName}の投稿`)}</title>`,
      `      <description>${escapeXml(post.body)}</description>`,
      `      <pubDate>${new Date(post.createdAt).toUTCString()}</pubDate>`,
      "    </item>",
    ].join("\n");
  }).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(profile.displayName)} (@${escapeXml(profile.handle)})</title>`,
    `    <link>${escapeXml(profileUrl)}</link>`,
    `    <description>${escapeXml(profile.bio || `${profile.displayName}のHub公開ポスト`)}</description>`,
    `    <atom:link href="${escapeXml(`${origin}/api/federation/rss/${encodeURIComponent(profile.handle)}`)}" rel="self" type="application/rss+xml" />`,
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export function buildPublicPostEmail(origin: string, post: PublicFederationPost & {
  handle: string;
  displayName: string;
}) {
  const postUrl = `${origin}/posts/${encodeURIComponent(post.id)}`;
  const subjectBody = post.body.replace(/\s+/g, " ").trim().slice(0, 72);
  const subject = safeMailHeader(subjectBody || `${post.displayName}のHub投稿`);
  const fromName = safeMailHeader(`${post.displayName} (@${post.handle})`);
  const body = `${post.body}\r\n\r\nHubで見る: ${postUrl}\r\n`;
  return [
    `From: ${fromName} <noreply@invalid>`,
    `Subject: ${subject}`,
    `Date: ${new Date(post.createdAt).toUTCString()}`,
    `Message-ID: <hub-post-${safeMailHeader(post.id)}@invalid>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}
