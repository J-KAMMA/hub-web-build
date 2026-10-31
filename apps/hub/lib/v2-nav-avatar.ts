import type { V2NavItem } from "@/components/v2/v2-shell";

/*
 * 左ナビのプロフィール項目に出す本人の顔（2026-10-15 所有者）。
 * 画像は Hub 自身の avatar 経路（"/" 始まりの相対パス）だけを許す。外部 URL は頭字に落とす。
 */
export function ownAvatarSrc(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
  return url;
}

export function profileNavAvatar(profile: { id?: string | null; displayName?: string | null; avatarUrl?: string | null }): NonNullable<V2NavItem["avatar"]> {
  if (!profile.id) return { name: null, src: null };
  return { name: profile.displayName ?? null, src: ownAvatarSrc(profile.avatarUrl) };
}
