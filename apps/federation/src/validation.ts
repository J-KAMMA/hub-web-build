import type { JsonObject } from "./types";

const HANDLE = /^[a-z0-9_][a-z0-9_.-]{0,29}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export function record(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function string(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function handle(value: unknown): value is string {
  return typeof value === "string" && HANDLE.test(value);
}

export function opaqueId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/*
 * 手元の2 Hub 試験用の例外（2026-10-12、docs/hub-decentralization/DESIGN.md 8.0）。
 *
 * 下の3条件がすべて揃ったときだけ、http のループバック origin を「安全な外部 URL」として扱う。
 *   1. このWorker自身の FEDERATION_ORIGIN が http://localhost:PORT か http://127.0.0.1:PORT である
 *      （本番は https のドメインなので、この条件で必ず外れる）
 *   2. FEDERATION_DEV_LOOPBACK_PEERS に、正確な origin（スキーム・ホスト・ポート）が列挙されている
 *   3. 照合は origin の完全一致だけ。ワイルドカードも、他のポートも、他のホストも通さない
 * 本番の wrangler 設定にこの変数を置いてはならない（tests/production-readiness.test.ts が拒む）。
 */
let devLoopbackOrigins: ReadonlySet<string> = new Set();

function loopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.username || url.password || !url.port) return null;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function configureDevLoopbackPeers(
  env: { FEDERATION_ORIGIN?: string; FEDERATION_DEV_LOOPBACK_PEERS?: string },
): void {
  const self = typeof env.FEDERATION_ORIGIN === "string" ? loopbackOrigin(env.FEDERATION_ORIGIN) : null;
  const listed = typeof env.FEDERATION_DEV_LOOPBACK_PEERS === "string" ? env.FEDERATION_DEV_LOOPBACK_PEERS : "";
  if (!self || !listed.trim()) {
    devLoopbackOrigins = new Set();
    return;
  }
  const peers = listed.split(",").map((entry) => loopbackOrigin(entry.trim()));
  if (peers.some((peer) => peer === null)) {
    // 1件でも形が崩れていたら全体を無効にする（黙って一部だけ通さない）。
    devLoopbackOrigins = new Set();
    return;
  }
  devLoopbackOrigins = new Set([self, ...(peers as string[])]);
}

export function devLoopbackEnabled(): boolean {
  return devLoopbackOrigins.size > 0;
}

export function safeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (devLoopbackOrigins.has(url.origin) && !url.username && !url.password) return true;
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const parts = host.split(".").map(Number);
      if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
          (parts[0] === 169 && parts[1] === 254) ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168)) return false;
    }
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
    return host.includes(".");
  } catch {
    return false;
  }
}

/*
 * 'user@host' の host から WebFinger を引く origin を作る。
 * 通常は https の公開ドメインだけ。手元の試験台では、許可された loopback origin（http・ポート付き）に限り通す。
 */
export function originForHost(host: string): string | null {
  const lower = host.trim().toLowerCase();
  if (devLoopbackOrigins.has(`http://${lower}`)) return `http://${lower}`;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(lower)) return null;
  const origin = `https://${lower}`;
  return safeExternalUrl(origin) ? origin : null;
}

/** 手元の試験台でだけ、ポート付きの loopback host をドメイン方針に登録できるようにする。 */
export function devLoopbackPolicyDomain(value: string): boolean {
  return devLoopbackOrigins.size > 0 && /^(?:localhost|127\.0\.0\.1):\d{2,5}$/.test(value);
}

/** HTML を、改行を残した素の文字列にする。タグは落とし、実体参照は戻す。Hub は表示時に自分で escape する。 */
export function plainTextFromHtml(value: unknown, max = 20_000): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

export function domainFromUrl(value: string): string {
  const url = new URL(value);
  // 手元試験では 127.0.0.1 の2つの Hub を区別するため、許可された origin に限りポート付きにする。
  if (devLoopbackOrigins.has(url.origin)) return url.host.toLowerCase();
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function sanitizeInboundHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return escapeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 20_000);
}
