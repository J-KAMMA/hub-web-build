import type { HubUiSurface } from "@/lib/hub-surface-path";

/*
 * 設定の節への行き先（2026-09-05、旦那様の「全部を v2 に」）。
 *
 * 既存は 1 枚の /settings に `#storage` のような錨で入る。v2 も 1 枚だが、
 * 錨の名前が `#v2-settings-storage` で、節の切り方も同じではない。
 * hubSurfacePath は道を写すだけで錨を知らないので、ここで対応を持つ。
 *
 * 2026-09-07 から /settings そのものが v2 へ転送されるので、ここは
 * 既存の錨を持ったまま着いた人の読み替え（V2SettingsAnchor）にも使う。
 * **v2 に同じ節が無い錨（account）は書かない。** 無いものを書くと、
 * 節が在るように見えて頭に落ちる。
 */
const V2_SECTIONS: Record<string, string> = {
  /* 既存と同じ節が v2 にもある。 */
  storage: "storage",
  notifications: "notifications",
  "external-protocols": "external-protocols",
  "personal-node": "personal-node",
  federation: "federation",
  "distributed-network": "distributed-network",
  "data-portability": "data-portability",
  "agent-access": "agent-access",
  posts: "posts",
  display: "display",
  /* 既存の「端末のデータ」は表示設定を初期値に戻すボタン。v2 では表示の節の中。 */
  "device-data": "display",
  /* 既存の「プライバシー」は安全の設定。v2 では「コンテンツの安全」。 */
  privacy: "safety",
  /* v2 では別名詞の下にある。 */
  "translation-settings": "translation",
  /* 独自ドメインは v2 では外部SNS連携の節の中（FederationSettings の隣）。 */
  "domain-alias": "federation",
};

/* 既存の錨（storage 等）に当たる v2 の錨の id。無ければ null。 */
export function v2SettingsAnchorFor(section: string): string | null {
  const target = V2_SECTIONS[section];
  return target ? `v2-settings-${target}` : null;
}

/*
 * 面に合った設定の節を返す。v2 に無い節は既存の設定へ渡す——行き先そのものが
 * 消えるより、既存の画面で開くほうがいい。
 */
export function settingsSectionHref(surface: HubUiSurface, section: string): string {
  if (surface !== "/v2") return `/settings#${section}`;
  const target = V2_SECTIONS[section];
  return target ? `/v2/settings#v2-settings-${target}` : `/settings#${section}`;
}
