import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { WORLD_BUDGET, clean } from "@jkamma/gltf-guard";

/**
 * 買われた品の絵を、世界へ取り寄せる。
 *
 * **Vault のバイト列も信じない。** あちら側でも検めているが、そこを通ったから
 * といって、こちらで検めない理由にはならない。経路が1本増えるたびに、そこが
 * 素通しになっていないかを見る場所が要る。**同じ検めを、受け取る側でもう一度。**
 *
 * 取り寄せたら、世界の配信元に置く。以後は静かなファイルとして配られる——
 * 見る人ごとに認証を挟まない。世界の中に居る人は買っていないので、購入の証明では
 * 通せないし、かといって Vault を誰にでも開けば、売り物の配り場になる。
 * **開くのは世界のサーバに対してだけ**にして、そこから先は世界が受け持つ。
 */

/** 品の名前の形。**道を跨がせない。** ここは実際に道を組み立てる場所。 */
const CONTENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u;

/** 取り寄せに待つ時間。長く待つと、置く操作がそのぶん詰まる。 */
const TIMEOUT_MS = 8_000;

/** 一度断られた品を、置かれるたびに取りに行かない。 */
const failed = new Map<string, number>();
const RETRY_MS = 60_000;

export type Fetcher = {
  /** Vault の場所。置いていなければ、取り寄せない。 */
  origin: string;
  /** 世界のサーバだけに渡された合言葉。 */
  token: string;
  /** 置き先（public/bought）。 */
  folder: string;
};

export function readFetcher(env: NodeJS.ProcessEnv, folder: string): Fetcher | null {
  const origin = env.VAULT_ORIGIN?.trim() ?? "";
  const token = env.WORLD_SERVICE_TOKEN?.trim() ?? "";
  if (!origin || !token) return null;
  try {
    const url = new URL(origin);
    // 平文で合言葉を出さない。**手元の稽古だけ例外にする。**
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    return { origin: url.origin, token, folder };
  } catch {
    return null;
  }
}

/** もう手元にあるか。 */
export function haveBought(folder: string, content: string): boolean {
  return CONTENT.test(content) && existsSync(join(folder, `${content}.glb`));
}

/**
 * 取り寄せる。**取れたら true。**
 *
 * 取れなくても落とさない。絵が無いだけで、世界は動く。
 */
export async function fetchBought(fetcher: Fetcher, content: string, at = Date.now()): Promise<boolean> {
  if (!CONTENT.test(content)) return false;
  if (haveBought(fetcher.folder, content)) return true;
  const lost = failed.get(content) ?? 0;
  if (at - lost < RETRY_MS) return false;

  const stop = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const answer = await fetch(`${fetcher.origin}/api/world/assets/${encodeURIComponent(content)}`, {
      headers: { authorization: `Bearer ${fetcher.token}` },
      signal: stop
    });
    if (!answer.ok) {
      failed.set(content, at);
      console.warn(`買った物を取り寄せられない: ${content} (${answer.status})`);
      return false;
    }
    const bytes = new Uint8Array(await answer.arrayBuffer());
    // **もう一度検める。** 経路が1本増えるたびに、そこが素通しになっていないかを
    // 見る場所が要る。あちらで通ったことは、こちらで見ない理由にならない。
    const done = clean(bytes, WORLD_BUDGET);
    if (!done.ok) {
      failed.set(content, at);
      console.warn(`取り寄せた物が検めを通らない: ${content} — ${done.reason}`);
      return false;
    }
    const path = join(fetcher.folder, `${content}.glb`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, done.bytes);
    console.log(`買った物を取り寄せた: ${content}（${(done.bytes.length / 1024).toFixed(0)}KB）`);
    return true;
  } catch (error) {
    failed.set(content, at);
    console.warn(`買った物を取り寄せられない: ${content}`, error);
    return false;
  }
}
