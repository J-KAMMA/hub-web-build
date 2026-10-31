export type ProfileExternalLink = { label: string; url: string };

const PRIVATE_IPV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;
const IPV6_LITERAL = /^\[.*\]$/u;

export class ProfileExternalLinkError extends Error {}

export function parseProfileExternalLinks(input: unknown): ProfileExternalLink[] {
  if (!Array.isArray(input) || input.length > 3) {
    throw new ProfileExternalLinkError("外部リンクは3件まで登録できます。");
  }
  const links = input.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ProfileExternalLinkError("リンクの入力を確認してください。");
    const rawUrl = typeof Reflect.get(entry, "url") === "string" ? String(Reflect.get(entry, "url")).trim() : "";
    const rawLabel = typeof Reflect.get(entry, "label") === "string" ? String(Reflect.get(entry, "label")).trim() : "";
    if (!rawUrl) return null;
    if (rawUrl.length > 2048) throw new ProfileExternalLinkError("URLが長すぎます。");
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new ProfileExternalLinkError("正しいURLを入力してください。"); }
    const hostname = url.hostname.toLocaleLowerCase("en");
    if (url.protocol !== "https:" || url.username || url.password || !hostname) {
      throw new ProfileExternalLinkError("httpsの公開URLだけを登録できます。");
    }
    if (hostname === "localhost" || hostname.endsWith(".localhost") || PRIVATE_IPV4.test(hostname) || IPV6_LITERAL.test(hostname)) {
      throw new ProfileExternalLinkError("ローカルまたは非公開ネットワークのURLは登録できません。");
    }
    const label = rawLabel || hostname.replace(/^www\./u, "");
    if (label.length > 40) throw new ProfileExternalLinkError("リンク名は40文字以内にしてください。");
    url.hash = "";
    return { label, url: url.toString() };
  }).filter((link): link is ProfileExternalLink => Boolean(link));
  if (new Set(links.map((link) => link.url)).size !== links.length) {
    throw new ProfileExternalLinkError("同じURLは1件だけ登録できます。");
  }
  return links;
}
