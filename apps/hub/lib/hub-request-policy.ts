/*
 * The single implementation of Hub's per-request gating.
 *
 * Next 16 pins `proxy.ts` to the Node.js runtime, which the Cloudflare adapter
 * refuses to bundle, so the Worker cannot rely on proxy running in production.
 * The Worker entry point sits in the same unmissable position, so both call
 * this module and neither owns a second copy of the rules. Every decision here
 * is derived from the path and the environment alone, so it stays a pure
 * function that can be tested without a request.
 */

import { shouldBlockCloudflareTraffic } from "./cloudflare/deployment-phase";
import { isAdvertisingEnabled, normalizeAdSenseClientId } from "./advertising";
import { buildHubContentSecurityPolicy } from "./advertising-policy";
import { HUB_LOCALE_COOKIE, localeFromAcceptLanguage, resolveHubLocale, type HubLocale } from "./i18n";
import { v2EntryFor } from "@/lib/hub-v2-entry";
import { isOptionalPathDisabled } from "./optional-services";

export interface HubRequestPolicyEnv {
  CLOUDFLARE_BINDINGS_LOCAL?: string;
  HUB_SNS_CORE_ONLY?: string;
  HUB_MAINTENANCE_MODE?: string;
  HUB_TIPS_ENABLED?: string;
  HUB_SOCIAL_POSTING_ENABLED?: string;
  HUB_ADVERTISING_ENABLED?: string;
  HUB_SEARCH_ENABLED?: string;
  HUB_ADS_PROVIDER?: string;
  HUB_ADSENSE_CLIENT_ID?: string;
  CLOUDFLARE_RUNTIME?: string;
  CLOUDFLARE_DEPLOYMENT_PHASE?: string;
  HUB_PUBLIC_ORIGIN?: string;
  HUB_JKAMMA_SERVICES?: string;
}

export interface HubRequestPolicyInput {
  pathname: string;
  /*
   * 問い合わせ文字列（"?q=…"）。渡さないと転送で消える。
   * 二種類ある画面を v2 へ渡すとき、絞り込みや検索語ごと持っていく。
   */
  search?: string;
  /** The `lang` query parameter, when present. */
  requestedLocale: string | null;
  acceptLanguage: string | null;
  hasLocaleCookie: boolean;
  /** Whether the request arrived over https, which gates the Secure cookie flag. */
  secure: boolean;
  /** Correlates a pre-launch rejection with the edge log. */
  requestId: string;
}

export interface HubLocaleCookie {
  name: string;
  value: HubLocale;
  httpOnly: false;
  maxAge: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
}

export type HubRequestPolicyResult =
  | {
      type: "block";
      status: number;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }
  | { type: "redirect"; pathname: string; search: string; status: number }
  | { type: "continue"; headers: Record<string, string>; localeCookie: HubLocaleCookie | null };

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/*
 * Reachable only while the initial SNS release is running. These are whole
 * product areas, so a prefix match is deliberate.
 */
const NON_CORE_PREFIXES = [
  "/ai",
  "/compute",
  "/earnings",
  "/jobs",
  "/market",
  "/music",
  "/services",
  "/shopping",
  "/token",
  "/travel",
  "/vault",
  "/wallet",
  "/work",
  "/advertising",
  "/api/ads",
  "/api/market",
  "/api/monetization",
  "/api/music",
  "/api/tips",
  "/api/token-rankings",
  "/api/wallet",
  "/api/work-listings",
] as const;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function isAdSenseConfigured(env: HubRequestPolicyEnv): boolean {
  return isAdvertisingEnabled(env.HUB_ADVERTISING_ENABLED)
    && String(env.HUB_ADS_PROVIDER) === "legacy"
    && Boolean(normalizeAdSenseClientId(env.HUB_ADSENSE_CLIENT_ID));
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 成人層。**検索索引には載せる**が、広告は出さない。
 *
 * 索引に載せるのは、検索から来た読者をHubに入れるため。そのぶん、この層に
 * AdSenseを載せる道は塞がる——アダルトを索引に置いたドメインでAdSenseを使うと、
 * 制裁はページ単位ではなくアカウント単位で来る。
 *
 * 記事側で広告部品を書かない約束は守られていても、それは約束であって保証ではない。
 * CSPからAdSenseのホストを外しておけば、仮にタグが混入してもブラウザが読み込みを止める。
 * ここは索引の方針を変えても外さないこと。
 */
export function isAdultPath(pathname: string): boolean {
  return matchesPrefix(pathname, "/adult");
}

export function hubSecurityHeaders(pathname: string, env: HubRequestPolicyEnv): Record<string, string> {
  // AdSenseを外すのは成人層（/adult）だけ。索引の可否とは別の判定。
  const noAdSense = isAdultPath(pathname);
  return {
    "Content-Security-Policy": buildHubContentSecurityPolicy(
      pathname,
      noAdSense ? false : isAdSenseConfigured(env),
    ),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": env.CLOUDFLARE_BINDINGS_LOCAL === "true" ? "SAMEORIGIN" : "DENY",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "X-Robots-Tag": pathname.startsWith("/admin/") ? "noindex, nofollow" : "index, follow",
  };
}

export function decideHubRequest(
  input: HubRequestPolicyInput,
  env: HubRequestPolicyEnv,
): HubRequestPolicyResult {
  const { pathname } = input;

  if (env.HUB_SNS_CORE_ONLY === "true" && NON_CORE_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return {
      type: "block",
      status: 404,
      body: { error: "This feature is not available in the initial SNS release." },
      headers: { ...NO_STORE },
    };
  }

  /* 自前運営のHubには無い任意部品。止まっているのではなく存在しないので、503でなく404（DESIGN 5.1）。 */
  if (isOptionalPathDisabled(pathname, input.search ?? "", env as Record<string, string | undefined>)) {
    return {
      type: "block",
      status: 404,
      body: { error: "Not found" },
      headers: { ...NO_STORE },
    };
  }

  /*
   * Vault の利用者向け画面は Hub から外した（2026-10-15）。/vault は恒久転送（301）で Hub の入口へ。
   * 検索文字列（?content=...）は捨てる。/vault/api/* は端で Vault Worker へ渡るのでここでは触れない
   * （完全一致のみ）。任意部品の404より後ろ＝Vault を持たない自前 Hub は従来どおり404。
   */
  if (pathname === "/vault") {
    return { type: "redirect", pathname: "/", search: "", status: 301 };
  }

  if (pathname === "/ranking") {
    /* /search 自身が /v2/search へ渡るので、継ぎ目なしに v2 へ直行させる。 */
    return { type: "redirect", pathname: "/v2/search", search: "", status: 308 };
  }

  const maintenanceBypass = pathname === "/api/health"
    || pathname.startsWith("/admin/")
    || pathname.startsWith("/api/admin/");
  if (env.HUB_MAINTENANCE_MODE === "true" && !maintenanceBypass) {
    return {
      type: "block",
      status: 503,
      body: { error: "Hubはメンテナンス中です。", retryable: true },
      headers: { ...NO_STORE, "Retry-After": "300" },
    };
  }

  const emergencyControls: Array<[string, string | undefined]> = [
    ["/api/tips/", env.HUB_TIPS_ENABLED],
    ["/api/social/posts", env.HUB_SOCIAL_POSTING_ENABLED],
    ["/api/ads/", env.HUB_ADVERTISING_ENABLED],
    ["/api/search", env.HUB_SEARCH_ENABLED],
  ];
  if (emergencyControls.some(([prefix, value]) => pathname.startsWith(prefix) && value === "false")) {
    return {
      type: "block",
      status: 503,
      body: { error: "この機能は一時停止中です。" },
      headers: { ...NO_STORE, "Retry-After": "300" },
    };
  }

  if (shouldBlockCloudflareTraffic(env.CLOUDFLARE_RUNTIME, env.CLOUDFLARE_DEPLOYMENT_PHASE)) {
    return {
      type: "block",
      status: 503,
      body: {
        error: "Hub Cloudflare staging is not ready for public traffic.",
        requestId: input.requestId,
      },
      headers: { ...NO_STORE, "Retry-After": "3600" },
    };
  }

  /*
   * 二種類ある画面は新しいほう（v2）を出す（2026-09-04、旦那様の決定）。
   *
   * v2 に同じ画面が在る76本だけを渡す。v2 に無い39本（管理画面、出品、
   * 本の巻、論文、アダルト、規約）は既存のまま。v2 がわざと既存へ渡している
   * 6本も残す——転送すると行き先そのものが消える。
   *
   * 307（一時）にする。**308（恒久）はブラウザが覚えてしまい、
   * 取り消しても手元では戻らない。** 戻せる形で出す。
   *
   * **遮断より後ろに置く。** 先に置いたら、メンテナンス中と公開前の 503 を
   * 素通りして転送していた（lib/hub-request-policy.test.ts が7件で捕まえた）。
   * 止めるべき要求は、行き先を変える前に止める。
   */
  const v2Entry = v2EntryFor(pathname);
  if (v2Entry) {
    /*
     * 既存のメッセージはメールを ?channel=email で同じ画面に出す。v2 は
     * メールを別の画面（/v2/messages/email）に分けたので、道の名前だけ渡すと
     * メールの受信箱へ行こうとした人が DM に着く（2026-09-07）。
     * 振り分けは道の名前しか見ない v2EntryFor ではなく、検索文字列を持つここで。
     */
    if (v2Entry === "/v2/messages") {
      const params = new URLSearchParams(input.search ?? "");
      if (params.get("channel") === "email") {
        params.delete("channel");
        const rest = params.toString();
        return { type: "redirect", pathname: "/v2/messages/email", search: rest ? `?${rest}` : "", status: 307 };
      }
    }
    return { type: "redirect", pathname: v2Entry, search: input.search ?? "", status: 307 };
  }

  return {
    type: "continue",
    headers: hubSecurityHeaders(pathname, env),
    localeCookie: input.hasLocaleCookie
      ? null
      : {
          name: HUB_LOCALE_COOKIE,
          value: input.requestedLocale
            ? resolveHubLocale(input.requestedLocale)
            : localeFromAcceptLanguage(input.acceptLanguage),
          httpOnly: false,
          maxAge: LOCALE_COOKIE_MAX_AGE,
          path: "/",
          sameSite: "lax",
          secure: input.secure,
        },
  };
}
