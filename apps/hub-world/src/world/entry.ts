/**
 * 署名の検めは **WebCrypto だけ**を使う。
 *
 * node:crypto を使うと、Cloudflare の Durable Object で動かせない。両方で同じ
 * 実装が動く形にしておけば、**殻を替えても検め方は替わらない**——検め方が
 * 2つあると、そのうち片方だけが緩む。
 *
 * 代わりに非同期になる。呼ぶ側は await する。
 */

/**
 * 世界へ入る許可を検める。
 *
 * **今まで誰でも名乗れた。** 客が送ってきた名前をそのまま身元にしていたので、
 * 127.0.0.1 に閉じていた。ここが入って初めて、外へ開ける。
 *
 * 形式は自分で決めない。`services/identity/src/account-assertion.js` が既に
 * 使っている作法に合わせる——**EdDSA の短命アサーション**で、
 * iss / aud / purpose / sub / jti / iat / exp を検める。新しい形式を増やすと、
 * 検め方も増え、そのどれかが緩む。
 *
 * ここは伝送路も描画も読まない。**鍵と文字列だけを見る。**
 */

/** SPKI（base64、または PEM）を、検める鍵にする。 */
const keys = new Map<string, Promise<CryptoKey | null>>();

function toBytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

/**
 * 鍵を1度だけ読む。**毎回読み直すと、接続のたびに解く仕事が増える。**
 */
function toKey(value: string): Promise<CryptoKey | null> {
  const held = keys.get(value);
  if (held) return held;
  const made = (async () => {
    try {
      const base64 = value.includes("BEGIN PUBLIC KEY")
        ? value.replace(/-----[A-Z ]+-----/gu, "").replace(/s+/gu, "")
        : value;
      return await crypto.subtle.importKey("spki", toBytes(base64), { name: "Ed25519" }, false, ["verify"]);
    } catch {
      return null;
    }
  })();
  keys.set(value, made);
  return made;
}

const ISSUER = "jkamma-account";
const PURPOSE = "world_enter";

/**
 * 宛先。**サーバごとに違う。**
 *
 * 口座は宛先ごとに別の識別子を配る。宛先を1つに固定すると、第三者が建てた
 * サーバは**全員が同じ識別子を見る**ことになり、運営者どうしが突き合わせれば
 * 「A のサーバのこの人は、B のサーバのこの人だ」と分かる。行き先が筋になって
 * 見えてしまう。
 *
 * この台の世界は jkamma-hub-world。第三者の分は jkamma-hub-world:<名前>。
 */
export const PLATFORM_AUDIENCE = "jkamma-hub-world";

/** サーバの名前の形。**宛先の一部になるので、緩めない。** */
const SERVER = /^[a-z0-9][a-z0-9-]{0,30}$/u;

export function audienceOf(server?: string | null): string {
  if (!server) return PLATFORM_AUDIENCE;
  if (!SERVER.test(server)) throw new Error("サーバの名前の形が違う");
  return PLATFORM_AUDIENCE + ":" + server;
}

/**
 * 署名された言い分を検める。**用途ごとに書き写さない。**
 *
 * 検め方が2つあると、そのうち片方だけが緩む。実際にそうなる場所なので、
 * ここを1つにして、違うのは用途と、用途ごとに要る項目だけにする。
 *
 * **署名を先に見る。** 中身を信じてから署名を見る順で書くと、その順を真似た
 * 誰かが、いつか署名の確認を落とす。
 */
export type Claims = Record<string, unknown>;

export async function readAssertion(
  compact: unknown,
  publicKey: string,
  purpose: string,
  /** この殻が名乗る宛先。**自分宛でないものを通さない。** */
  audience: string,
  now = new Date()
): Promise<Claims | null> {
  if (typeof compact !== "string" || compact.length === 0 || compact.length > MAX_LENGTH) return null;
  if (!publicKey) return null;

  const parts = compact.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(toBytes(parts[0]!.replace(/-/gu, "+").replace(/_/gu, "/"))));
    const claims = JSON.parse(new TextDecoder().decode(toBytes(parts[1]!.replace(/-/gu, "+").replace(/_/gu, "/"))));
    if (header?.alg !== "EdDSA" || header?.typ !== "JWT") return null;

    const key = await toKey(publicKey);
    if (!key) return null;
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = toBytes(parts[2]!.replace(/-/gu, "+").replace(/_/gu, "/"));
    if (!await crypto.subtle.verify("Ed25519", key, signature, signed)) return null;

    const current = Math.floor(now.getTime() / 1000);
    if (
      claims?.iss !== ISSUER ||
      claims?.aud !== audience ||
      claims?.purpose !== purpose ||
      typeof claims.sub !== "string" ||
      !/^[A-Za-z0-9_-]{8,160}$/u.test(claims.sub) ||
      typeof claims.jti !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(claims.jti) ||
      typeof claims.iat !== "number" ||
      typeof claims.exp !== "number" ||
      // 未来から来た言い分を受けない。時計のずれぶんだけ許す。
      claims.iat > current + 30 ||
      claims.exp <= current ||
      claims.exp - claims.iat > MAX_TTL_SECONDS
    ) {
      return null;
    }
    return claims as Claims;
  } catch {
    return null;
  }
}

/** 許可の寿命の上限（秒）。長いほど、盗まれたときに使える時間が延びる。 */
export const MAX_TTL_SECONDS = 300;
/** 受け取る文字列の上限。長い入力は、それだけで負荷になる。 */
export const MAX_LENGTH = 4096;
/** 使い終えた許可を憶えておく時間（ミリ秒）。寿命より少し長く持つ。 */
export const REMEMBER_MS = (MAX_TTL_SECONDS + 60) * 1000;

export type Pass = {
  /** Hub Account の識別子。**これが身元。** */
  subject: string;
  /** 表示名。**まだ他人が書いた文字列**として扱う（発行側が入れた値であっても）。 */
  name: string;
  jti: string;
  expiresAt: number;
};

/**
 * 検める。**通らなければ null。理由は返さない。**
 *
 * どこで落ちたかを返すと、試す側に手掛かりを与える。運用で困るなら、
 * サーバの記録に残す——客へは返さない。
 */
export async function readPass(
  compact: unknown,
  publicKey: string,
  audience = PLATFORM_AUDIENCE,
  now = new Date()
): Promise<Pass | null> {
  const claims = await readAssertion(compact, publicKey, PURPOSE, audience, now);
  // 表示名は世界へ入るときだけ要る。**用途ごとに要る項目は、用途の側で見る。**
  if (!claims || typeof claims.name !== "string") return null;
  return {
    subject: claims.sub as string,
    name: claims.name,
    jti: claims.jti as string,
    expiresAt: claims.exp as number
  };
}

/**
 * 一度使った許可を、二度使わせない。
 *
 * 署名が正しくても、**同じ許可を横取りして何度も使えるなら意味が無い**。
 * 寿命が短いので、憶えておく量も知れている。
 */
export class UsedPasses {
  private readonly seen = new Map<string, number>();

  /** 初めてなら true。二度目は false。 */
  take(jti: string, at = Date.now()): boolean {
    this.forget(at);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, at);
    return true;
  }

  /** 古いものを捨てる。**捨てないと、増え続けて落ちる。** */
  private forget(at: number): void {
    for (const [jti, when] of this.seen) {
      if (at - when > REMEMBER_MS) this.seen.delete(jti);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * 1つの口座が持てる接続の数。
 *
 * **これが無いと、1人で部屋を埋められる。** 許可は120秒ごとに取り直せるので、
 * 何本でも繋げてしまう。窓を2つ開ける・端末を持ち替える程度は許して、それ以上は断る。
 */
export const SEATS_PER_ACCOUNT = 3;

/** 誰が何本繋いでいるかを数える。 */
export class Seats {
  private readonly held = new Map<string, number>();

  /** 座れたら true。いっぱいなら false。 */
  take(id: string, limit = SEATS_PER_ACCOUNT): boolean {
    const now = this.held.get(id) ?? 0;
    if (now >= limit) return false;
    this.held.set(id, now + 1);
    return true;
  }

  /** 離す。**0になったら消す**——名前だけが残り続けると、増える一方になる。 */
  release(id: string): void {
    const now = this.held.get(id) ?? 0;
    if (now <= 1) this.held.delete(id);
    else this.held.set(id, now - 1);
  }

  count(id: string): number {
    return this.held.get(id) ?? 0;
  }

  get size(): number {
    return this.held.size;
  }
}