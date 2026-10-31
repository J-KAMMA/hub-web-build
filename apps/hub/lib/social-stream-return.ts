import { streamId } from './social-stream';

export function socialStreamReturnHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !value.startsWith("/v2?")) return null;
  const query = new URLSearchParams(value.slice(4)), social = query.get("social"), feed = query.get("feed");
  if (!social || !["all", "post", "thread", "community"].includes(social) || !feed || !["latest", "following"].includes(feed)) return null;
  const href = `/v2?social=${social}&feed=${feed}`;
  return value === href || value === `/v2?feed=${feed}&social=${social}` ? href : null;
}

export function withSocialStreamReturn(href: string, returnTo: unknown): string {
  const back = socialStreamReturnHref(returnTo);
  if (!back || !href.startsWith('/') || href.startsWith('//') || /[\\\p{Cc}]/u.test(href)) return href;
  try {
    const url = new URL(href, 'https://hub.invalid'), parts = url.pathname.slice(1).split('/');
    if (url.origin !== 'https://hub.invalid' || url.pathname !== href.split(/[?#]/u, 1)[0]) return href;
    const legacy = parts.length === 2 && ['posts', 'threads'].includes(parts[0]);
    const detail = legacy ? parts : parts.length === 3 && parts[0] === 'v2' ? parts.slice(1) : null;
    if (detail && ['posts', 'threads'].includes(detail[0]) && streamId(decodeURIComponent(detail[1]))) {
      if (legacy) url.pathname = '/v2' + url.pathname;
    } else if (url.pathname !== '/v2/community') return href;
    url.searchParams.set('returnTo', back);
    return url.pathname + url.search + url.hash;
  } catch { return href; }
}
