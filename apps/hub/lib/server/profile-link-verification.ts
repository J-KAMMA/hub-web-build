import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { assertSafeUrl } from "@/lib/encyclopedia/url-security";
import { getInstanceOrigin } from "@/lib/instance-origin";
import { LinkPreviewError, validatePublicPreviewUrl } from "@/lib/link-preview-url";
import { hasRelMeBackLink, profileBackLinkTargets } from "@/lib/profile-link-rel-me";

/*
 * プロフィールのリンクの本人確認（rel="me"）。
 *
 * 取りに行くのは保存時と「確認する」ボタンのときだけ。頁の表示からは呼ばない
 * （表示は readProfileLinkVerifications / readVerifiedLinkUrls でDBを読むだけ）。
 * 外へ出す取得の安全は link-preview と同じ部品を使う: https だけ、私設・ループバック・
 * リンクローカルを拒否（名前解決後のアドレスも見る）、リダイレクトは1回ごとに同じ検査、
 * 時間5秒・大きさ512KBの上限。
 *
 * 取り直しの間隔: 確認できたものは24時間。確認できなかったものは10分
 * （相手のページに逆リンクを足した直後に押せるように）。
 */

export type ProfileLinkVerificationStatus = "verified" | "unverified" | "error";
export type ProfileLinkVerificationMap = Record<string, { status: ProfileLinkVerificationStatus; checkedAt: string }>;

const VERIFIED_RECHECK_MS = 24 * 60 * 60 * 1000;
const FAILED_RECHECK_MS = 10 * 60 * 1000;
const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function validateForRuntime(rawUrl: string): Promise<URL> {
  const syntacticallySafe = validatePublicPreviewUrl(rawUrl);
  if (process.env.CLOUDFLARE_RUNTIME === "workers") return syntacticallySafe;
  try {
    return await assertSafeUrl(syntacticallySafe.toString());
  } catch {
    throw new LinkPreviewError("unsafe_url", "URL does not resolve to a public address.");
  }
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = MAX_HTML_BYTES - size;
    const slice = value.byteLength <= room ? value : value.subarray(0, room);
    size += slice.byteLength;
    chunks.push(slice);
    if (size >= MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** 相手のページを取り、逆リンクの有無を返す。取れなかった・危険なURLは "error"。 */
export async function checkRelMeLink(
  rawUrl: string,
  targets: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ProfileLinkVerificationStatus> {
  try {
    let current = await validateForRuntime(rawUrl);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(current, {
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "text/html,application/xhtml+xml", "user-agent": "JKamma-Hub-RelMe/1.0" },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) return "error";
        current = await validateForRuntime(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) return "error";
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (mime !== "text/html" && mime !== "application/xhtml+xml") return "error";
      const html = await readBounded(response);
      return hasRelMeBackLink(html, current.toString(), targets) ? "verified" : "unverified";
    }
    return "error";
  } catch {
    return "error";
  }
}

type Row = { url: string; status: ProfileLinkVerificationStatus; checked_at: string };

/** DBを読むだけ。頁の表示から呼んでよい（外への取得はしない）。 */
export async function readProfileLinkVerifications(database: D1Database, profileId: string): Promise<ProfileLinkVerificationMap> {
  const rows = await database.prepare("SELECT url, status, checked_at FROM profile_link_verifications WHERE profile_id = ?")
    .bind(profileId).all<Row>();
  const result: ProfileLinkVerificationMap = {};
  for (const row of rows.results) result[row.url] = { status: row.status, checkedAt: row.checked_at };
  return result;
}

/** いまの外部リンクと一致する、確認済みのURLの集合。DBを読むだけ。 */
export async function readVerifiedLinkUrls(database: D1Database, profileId: string): Promise<Set<string>> {
  const rows = await database.prepare(`SELECT v.url FROM profile_link_verifications v
    JOIN profile_external_links l ON l.profile_id = v.profile_id AND l.url = v.url
    WHERE v.profile_id = ? AND v.status = 'verified'`).bind(profileId).all<{ url: string }>();
  return new Set(rows.results.map((row) => row.url));
}

export async function verifyProfileLinks(
  database: D1Database,
  profile: { id: string; handle: string },
  urls: readonly string[],
  dependencies: { fetchImpl?: typeof fetch; now?: number; origin?: string } = {},
): Promise<ProfileLinkVerificationMap> {
  const now = dependencies.now ?? Date.now();
  const targets = profileBackLinkTargets(dependencies.origin ?? getInstanceOrigin(), profile.handle);
  const existing = await readProfileLinkVerifications(database, profile.id);

  // 外したリンクの結果は消す。
  const keep = new Set(urls);
  const stale = Object.keys(existing).filter((url) => !keep.has(url));
  if (stale.length) {
    await database.batch(stale.map((url) => database.prepare("DELETE FROM profile_link_verifications WHERE profile_id = ? AND url = ?").bind(profile.id, url)));
    for (const url of stale) delete existing[url];
  }

  const due = urls.filter((url) => {
    const previous = existing[url];
    if (!previous) return true;
    const age = now - Date.parse(previous.checkedAt);
    if (!Number.isFinite(age) || age < 0) return true;
    return age >= (previous.status === "verified" ? VERIFIED_RECHECK_MS : FAILED_RECHECK_MS);
  });

  const checkedAt = new Date(now).toISOString();
  const outcomes = await Promise.all(due.map(async (url) => ({ url, status: await checkRelMeLink(url, targets, dependencies.fetchImpl) })));
  if (outcomes.length) {
    await database.batch(outcomes.map(({ url, status }) => database.prepare(`INSERT INTO profile_link_verifications (profile_id, url, status, checked_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, url) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`)
      .bind(profile.id, url, status, checkedAt)));
    for (const { url, status } of outcomes) existing[url] = { status, checkedAt };
  }
  return existing;
}
