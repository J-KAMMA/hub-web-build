/**
 * 世界のサーバの居場所。
 *
 * **形を検めてから返す。** 環境変数をそのまま画面へ渡すと、置き間違えた値が
 * そのまま繋ぎ先になる。開発の外では暗号化された経路しか許さない——
 * 平文だと、話した内容も許可も途中で読める。
 */

const DEV = process.env.NODE_ENV === "development";

function loopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * 世界へ繋ぐ先。
 *
 * **既定は Hub 自身。** 区画は Hub の Durable Object にあるので、外の場所を
 * 指す理由が無い——同じ生い立ちなので CORS も要らない。空文字を返して、
 * 画面側に「今開いている場所の /world/live」を組み立てさせる。
 *
 * 別の場所を指したいとき（VPS に置いた古い形など）だけ、HUB_WORLD_ADDRESS を置く。
 */
export function worldAddress(): string {
  const configured = process.env.HUB_WORLD_ADDRESS ?? "";
  if (!configured) return "";
  const url = new URL(configured);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("HUB_WORLD_ADDRESS must be ws: or wss:");
  }
  if (url.protocol === "ws:" && !(DEV && loopback(url.hostname))) {
    // 平文は手元の稽古のときだけ。
    throw new Error("HUB_WORLD_ADDRESS must use wss: outside local development");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("HUB_WORLD_ADDRESS must not carry credentials or a query");
  }
  return url.href.replace(/\/$/, "");
}

/**
 * 彫った資産の置き場。末尾の / は落とす——画面側が `/zones/...` を足す。
 *
 * **既定は Hub 自身。** 街と住人の .glb は Hub の静かな資産として置く。
 */
export function worldAssets(): string {
  const configured = process.env.HUB_WORLD_ASSETS ?? "";
  if (!configured) return "";
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(DEV && url.protocol === "http:" && loopback(url.hostname))) {
    throw new Error("HUB_WORLD_ASSETS must be https outside local development");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("HUB_WORLD_ASSETS must not carry credentials or a query");
  }
  return url.origin;
}
