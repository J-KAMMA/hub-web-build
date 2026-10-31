import { PLATFORM_AUDIENCE, readAssertion } from "./entry";

/**
 * 買ったものを、世界へ置く権利。
 *
 * **世界は買い物の記録を持たない。** 誰が何を買ったかは Vault と Commerce に
 * あり、世界はそれを知らないままでいる方がいい——持てば、そこも守る対象になる。
 * 代わりに、**口座が署名した短命の言い分**を検める。世界へ入る許可と同じ形。
 *
 * 言い分が言うのは1つだけ:「この口座は、この品を世界へ置いてよい」。
 * 値段も、いつ買ったかも、何本持っているかも、世界には要らない。
 */

const PURPOSE = "world_place";

/**
 * 姿にする用途。**置くのとは分ける。**
 *
 * 分けないと、置く許可を持ってきて姿を替えられる。売る側から見れば「広場に
 * 飾ってよい椅子」と「着てよい体」は別の品で、値段も別につく。同じ言い分で
 * 両方できてしまうと、**片方だけ売るということができなくなる。**
 */
const WEAR_PURPOSE = "world_wear";

/** 品の名前の形。Vault の contentItem の id をそのまま使う。 */
const CONTENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u;

export type Owned = {
  /** 置いてよい口座。**置く人と一致しなければ通さない。** */
  subject: string;
  /** 置いてよい品。 */
  content: string;
  jti: string;
  expiresAt: number;
};

/**
 * 検める。**通らなければ null。**
 *
 * 用途（world_place）が違うものは通さない。世界へ入る許可を持ってきて品を
 * 置く、ということができてはいけない——**用途を分ける意味がそこにある。**
 */
export async function readOwned(
  compact: unknown,
  publicKey: string,
  audience = PLATFORM_AUDIENCE,
  now = new Date()
): Promise<Owned | null> {
  return read(compact, publicKey, PURPOSE, audience, now);
}

/**
 * 姿にしてよい、という言い分を検める。**用途が `world_wear` のものだけ。**
 *
 * 置く許可（`world_place`）を持ってきても通らない。
 */
export async function readWorn(
  compact: unknown,
  publicKey: string,
  audience = PLATFORM_AUDIENCE,
  now = new Date()
): Promise<Owned | null> {
  return read(compact, publicKey, WEAR_PURPOSE, audience, now);
}

async function read(
  compact: unknown,
  publicKey: string,
  purpose: string,
  audience: string,
  now: Date
): Promise<Owned | null> {
  const claims = await readAssertion(compact, publicKey, purpose, audience, now);
  if (!claims) return null;
  const content = claims.content;
  if (typeof content !== "string" || !CONTENT.test(content)) return null;
  return {
    subject: claims.sub as string,
    content,
    jti: claims.jti as string,
    expiresAt: claims.exp as number
  };
}

/**
 * 置ける品の控え。
 *
 * **言い分は短命なので、置いた後まで持たない。** 一度通ったら、その接続の間は
 * その品を置ける、という形にする。接続が切れれば消える——買ったことの記録では
 * ないので、消えて構わない。
 */
export class Allowed {
  private readonly held = new Map<string, Set<string>>();

  /** 通った言い分を控える。**置く人と一致しなければ、控えない。** */
  take(who: string, owned: Owned): boolean {
    if (owned.subject !== who) return false;
    const mine = this.held.get(who) ?? new Set<string>();
    mine.add(owned.content);
    this.held.set(who, mine);
    return true;
  }

  may(who: string, content: string): boolean {
    return this.held.get(who)?.has(content) ?? false;
  }

  /** 出ていったら忘れる。**残すと、増える一方になる。** */
  forget(who: string): void {
    this.held.delete(who);
  }

  get size(): number {
    return this.held.size;
  }
}
