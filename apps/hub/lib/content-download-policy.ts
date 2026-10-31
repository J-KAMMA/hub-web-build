/**
 * Content download permission (2026-10-17, owner-approved; docs/hub-downloads/DESIGN.md).
 * Pure module: no server-only imports, so forms, pages and tests can share it.
 *
 * - "none" (the default): no download. The work still plays or displays.
 * - "entitled": only viewers who pass the work's Hub token gate (the author always may).
 * - "anyone": anyone who can see the work, signed in or not. A token gate still applies first.
 *
 * Creative Commons works lean towards "anyone": the license already permits redistribution, so
 * the form proposes it, and choosing "none" on a CC work shows a notice instead of a block.
 */

import { isCreativeCommonsLicense, isContentLicenseId } from "./content-license";

export const CONTENT_DOWNLOAD_POLICIES = ["none", "entitled", "anyone"] as const;
export type ContentDownloadPolicy = (typeof CONTENT_DOWNLOAD_POLICIES)[number];

export const DEFAULT_CONTENT_DOWNLOAD_POLICY: ContentDownloadPolicy = "none";

/** Hub-owned works that carry a setting row. Files and images follow their post or article. */
export const CONTENT_DOWNLOAD_TARGET_TYPES = ["post", "article", "video"] as const;
export type ContentDownloadTargetType = (typeof CONTENT_DOWNLOAD_TARGET_TYPES)[number];

/** What a download request names. Music tracks keep their setting in the Music service. */
export const CONTENT_DOWNLOAD_KINDS = ["file", "video", "music", "image"] as const;
export type ContentDownloadKind = (typeof CONTENT_DOWNLOAD_KINDS)[number];

export function isContentDownloadPolicy(value: unknown): value is ContentDownloadPolicy {
  return typeof value === "string" && (CONTENT_DOWNLOAD_POLICIES as readonly string[]).includes(value);
}

export function isContentDownloadKind(value: unknown): value is ContentDownloadKind {
  return typeof value === "string" && (CONTENT_DOWNLOAD_KINDS as readonly string[]).includes(value);
}

/** Exact values only; a typo must never widen access. Missing means the default. */
export function normalizeContentDownloadPolicy(value: unknown): ContentDownloadPolicy | null {
  if (value === undefined || value === null || value === "") return DEFAULT_CONTENT_DOWNLOAD_POLICY;
  return isContentDownloadPolicy(value) ? value : null;
}

function isCc(license: unknown): boolean {
  return isContentLicenseId(license) && isCreativeCommonsLicense(license);
}

/** The value a create/edit form proposes when the work has no saved setting yet. */
export function suggestedContentDownloadPolicy(license: unknown): ContentDownloadPolicy {
  return isCc(license) ? "anyone" : DEFAULT_CONTENT_DOWNLOAD_POLICY;
}

/** A CC work set to "none": allowed, but the form says the license already permits copies. */
export function needsCreativeCommonsDownloadNotice(license: unknown, policy: ContentDownloadPolicy): boolean {
  return policy === "none" && isCc(license);
}

/** Choices a target offers. Music has no purchase or gate, so it cannot offer "entitled". */
export function contentDownloadChoices(target: ContentDownloadTargetType | "music"): readonly ContentDownloadPolicy[] {
  return target === "music" ? ["none", "anyone"] : CONTENT_DOWNLOAD_POLICIES;
}

export function contentDownloadPolicyLabel(policy: ContentDownloadPolicy, japanese = true): string {
  switch (policy) {
    case "none":
      return japanese ? "ダウンロードさせない" : "No downloads";
    case "entitled":
      return japanese ? "閲覧条件を満たした人だけ" : "Only viewers who meet the access condition";
    case "anyone":
      return japanese ? "誰でもダウンロードできる" : "Anyone can download";
  }
}

/** Shown wherever downloads are off: playback stays possible and recording cannot be stopped. */
export function contentDownloadNoneNotice(japanese = true): string {
  return japanese
    ? "ダウンロードは許可されていません。再生・表示はできます。画面の録画や録音は防げません。"
    : "Downloads are not allowed. You can still play or view it. Screen and audio recording cannot be prevented.";
}

export function creativeCommonsDownloadNotice(japanese = true): string {
  return japanese
    ? "この作品のCCライセンスは、すでに複製と再配布を認めています。ダウンロードを止めても、受け取った人が配ることは止められません。"
    : "This work's CC license already permits copying and redistribution. Turning downloads off does not stop people who have a copy from sharing it.";
}

export function contentDownloadWatermarkNotice(japanese = true): string {
  return japanese
    ? "ダウンロードしたファイルには、ダウンロードごとの番号が入ります。名前やウォレットは入りません。"
    : "Each downloaded file carries a per-download number. It contains no name or wallet.";
}
