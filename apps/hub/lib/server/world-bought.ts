import { WORLD_BUDGET, clean } from "@jkamma/gltf-guard";

/**
 * 買った物の絵を配る。
 *
 * **Vault のバイト列も信じない。** あちら側でも検めているが、そこを通ったから
 * といって、こちらで検めない理由にはならない。経路が1本増えるたびに、そこが
 * 素通しになっていないかを見る場所が要る。
 *
 * Vault の口（`/api/world/assets/:id`）は**世界にだけ**開いている。世界の中に
 * 居る人は買っていないので購入の証明では通せないし、Vault を誰にでも開けば
 * 売り物の配り場になる。だから間に立って、書き直した版だけを配る。
 *
 * **一度検めたら憶える。** 同じ品を10人が見ても、検めるのは1度でいい。
 */

/** 品の名前の形。**道を跨がせない。** ここは実際に道を組み立てる場所。 */
const CONTENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u;

/** 取り寄せに待つ時間。長く待つと、見る人がそのぶん待たされる。 */
const TIMEOUT_MS = 8_000;

/** 憶えておく時間（秒）。品は入れ替わらないので、長めでよい。 */
const KEEP_SECONDS = 3600;

export async function serveBoughtModel(
  /**
   * 受けた要求そのもの。**憶え場の鍵に使う。**
   *
   * Workers の Request は DOM の Request と形が違う（cf を持つ）。ここで欲しい
   * のは道だけなので、その2つを跨げる形で受ける。
   */
  request: { url: string },
  env: CloudflareEnv,
  content: string
): Promise<Response> {
  if (!CONTENT.test(content)) return new Response("ありません", { status: 404 });

  const origin = env.VAULT_ORIGIN?.trim() ?? "";
  const token = env.WORLD_SERVICE_TOKEN?.trim() ?? "";
  // 置いていなければ、この口は無いものとして扱う。**在ることを教えない。**
  if (!origin || !token) return new Response("ありません", { status: 404 });

  const cache = caches.default;
  const key = new Request(request.url);
  const held = await cache.match(key);
  if (held) return held;

  let answer: Response;
  try {
    answer = await fetch(`${origin}/api/world/assets/${encodeURIComponent(content)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    return new Response("取り寄せられません", { status: 502 });
  }
  // **あちらの理由をそのまま返さない。** 何が置いてあるかを外へ漏らさない。
  if (!answer.ok) return new Response("ありません", { status: 404 });

  const bytes = new Uint8Array(await answer.arrayBuffer());
  const done = clean(bytes, WORLD_BUDGET);
  if (!done.ok) {
    console.warn(`取り寄せた物が検めを通らない: ${content} — ${done.reason}`);
    return new Response("ありません", { status: 404 });
  }

  const made = new Response(done.bytes, {
    headers: {
      "content-type": "model/gltf-binary",
      "cache-control": `public, max-age=${KEEP_SECONDS}`,
      "x-content-type-options": "nosniff"
    }
  });
  // 憶えるのは検めた後の姿。**受け取ったバイト列は残さない。**
  await cache.put(key, made.clone());
  return made;
}
