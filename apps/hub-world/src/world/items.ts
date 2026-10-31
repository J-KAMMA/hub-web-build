import type { Blocker } from "./collide";

/**
 * 置かれた物。**世界を、住んでいる人が変えられるようにする。**
 *
 * ここで扱うのは「こちらが彫った品物を、好きな場所に置く」までで、
 * **持ち込みの3Dは扱わない。** 他人の作った .glb は、ブラウザが解釈する入力
 * であって、展開すると膨れる圧縮も、桁外れの頂点数も、外へ取りに行く参照も
 * 入り得る。受け取る側の検めが要るので、それは別の仕事になる。
 *
 * この段でも、置く場所と数と文字は**全部こちらが決める**。送られてきた座標を
 * そのまま入れない——世界の他の場所と同じ扱いにする。
 *
 * 描画も伝送路も読まない。**品目の名前と寸法だけ**を持つ。
 */

export type ItemKind = "椅子" | "立て札" | "花壇" | "灯り" | "木" | "机" | "買った物";

type Spec = {
  /** 足元の太さ。**当たり判定と、物どうしの間隔**の両方に使う。 */
  radius: number;
  /** 通れないか。花壇は跨げないが、灯りの柱は細いので抜けられてよい。 */
  blocks: boolean;
  /** 文字を持てるか。**立て札だけ。** */
  writable: boolean;
};

/**
 * 品揃え。**増やすのはここだけ。**
 *
 * 名前が絵の側と結びつく（`public/items.glb` の中の同じ名前を出す）。
 * 絵が無い品目を足すと、置けるのに何も見えない物になる。
 */
export const CATALOGUE: Record<ItemKind, Spec> = {
  椅子: { radius: 1.3, blocks: true, writable: false },
  立て札: { radius: 0.5, blocks: true, writable: true },
  花壇: { radius: 1.6, blocks: true, writable: false },
  灯り: { radius: 0.4, blocks: false, writable: false },
  木: { radius: 0.8, blocks: true, writable: false },
  机: { radius: 1.1, blocks: true, writable: false },
  /**
   * 買った物。**絵はこちらが彫っていない。**
   *
   * 品の名前（content）で世界の配信元から読む。置くには、口座が署名した
   * 「この品を置いてよい」という短命の言い分が要る。太さは決め打ち——
   * 買った物の実寸に合わせると、大きいものを買うほど広い場所を占められる。
   */
  買った物: { radius: 1.2, blocks: true, writable: false }
};

/** 買った品の名前の形。**道を跨がせない。** */
const CONTENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u;

export function isContent(value: unknown): value is string {
  return typeof value === "string" && CONTENT.test(value);
}

export const ITEM_LIMITS = {
  /** 1区画に置ける総数。**埋め尽くさせない。** */
  perZone: 40,
  /** 1人が1区画に置ける数。 */
  perPerson: 6,
  /** 物どうしの最小の間。重ねて塔にするのを防ぐ。 */
  gap: 2.0,
  /** 自分からこの距離までにしか置けない。**遠くから置かせない。** */
  reach: 6.0,
  /** 立て札に書ける長さ。 */
  textLength: 60,
  /** 続けて置ける間隔（ミリ秒）。 */
  cooldown: 1200,
  /**
   * これだけ通報されたら、誰にも見えなくする。
   *
   * **1人で消せてはいけない。** 気に入らない物を消して回る道具になる。かといって
   * 多すぎると、居合わせた人数で届かなくなる。数人で足りる所に置く。
   */
  reportsToHide: 3,
  /**
   * 1区画に置ける「買った物」の数。
   *
   * **こちらが彫った品より厳しくする。** 絵はそれぞれ別のファイルなので、
   * 数がそのまま読み込みと描画呼び出しの数になる。彫った品は1つの束から
   * 複製するので、増えても読み込みは増えない。
   */
  boughtPerZone: 12
};

export type Item = {
  /** サーバが決める。**客が決めた id を信じない。** */
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
  /** 向き。ラジアン。 */
  facing: number;
  /** 置いた人の識別子。**片付けられるのはこの人だけ。** */
  owner: string;
  /** 立て札の文字。他の品目では空。 */
  text: string;
  /**
   * 通報した人。**数ではなく人で持つ。**
   *
   * 数だけだと、1人が繰り返し押して消せる。
   */
  reports: string[];
  /**
   * 買った品の名前。**買った物のときだけ。**
   *
   * これがそのまま配信元の道の一部になるので、形を厳しく見る。
   */
  content: string;
  at: number;
};

export function isKind(value: unknown): value is ItemKind {
  return typeof value === "string" && Object.hasOwn(CATALOGUE, value);
}

/**
 * 立て札の文字を整える。
 *
 * **看板は、いちばん人目に触れる持ち込み文字。** 発言は流れるが、これは
 * その場に残り、通りかかった全員が読む。だから発言より短くし、改行も許さない
 * ——縦に伸ばして視界を塞ぐ道具になる。
 */
export function cleanSign(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return [...text]
    .filter((one) => {
      const code = one.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f &&
        code !== 0x200b && code !== 0x200e && code !== 0x200f &&
        !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069) &&
        code !== 0xfeff;
    })
    .slice(0, ITEM_LIMITS.textLength)
    .join("")
    .trim();
}

/** 置いてある物を、通れない場所に変える。 */
export function blockersOf(items: readonly Item[]): Blocker[] {
  return items
    // **隠れた物は通れる。** 見えない壁になると、そこで止まった人に理由が無い。
    .filter((one) => CATALOGUE[one.kind].blocks && !isHidden(one))
    .map((one) => ({ kind: "circle" as const, x: one.x, y: one.z, radius: CATALOGUE[one.kind].radius }));
}

/**
 * 彫った街と、置かれた物を合わせる。
 *
 * **街の側は動かない。** 置いた物を消すたびに街の判定まで作り直すと、
 * どこかで彫った分を失う。
 */
export function solidOf(carved: readonly Blocker[], items: readonly Item[]): Blocker[] {
  return [...carved, ...blockersOf(items)];
}

export type Ground = {
  radius: number;
  /** 彫った街の、通れない場所。 */
  carved: readonly Blocker[];
};

export type Placed =
  | { ok: true; items: Item[]; item: Item }
  | { ok: false; reason: string };

/** 円の中か。 */
function inside(one: Blocker, x: number, z: number, room: number): boolean {
  if (one.kind === "circle") return Math.hypot(x - one.x, z - one.y) < one.radius + room;
  const dx = x - one.x;
  const dz = z - one.y;
  const cos = Math.cos(-one.turn);
  const sin = Math.sin(-one.turn);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  return Math.abs(rx) < one.width / 2 + room && Math.abs(rz) < one.depth / 2 + room;
}

/**
 * 置く。
 *
 * **断る理由は返す。** 世界へ入る許可と違い、ここは既に入っている人の操作なので、
 * 黙って落とすと「押しても何も起きない」画面になる。理由が手掛かりになって
 * 困るのは、身元を試されている場面だけ。
 *
 * @param mine 置く人が今立っている場所。**遠くから置かせない**ために要る。
 */
export function place(
  ground: Ground,
  items: readonly Item[],
  who: string,
  mine: { x: number; z: number },
  wish: { kind: unknown; x: unknown; z: unknown; facing?: unknown; text?: unknown; content?: unknown },
  at: number,
  nextId: () => string,
  /** 買った物のとき、この人がこの品を置いてよいか。**世界は買い物を知らない。** */
  mayPlace: (who: string, content: string) => boolean = () => false
): Placed {
  if (!isKind(wish.kind)) return { ok: false, reason: "その品はありません" };

  let content = "";
  if (wish.kind === "買った物") {
    if (!isContent(wish.content)) return { ok: false, reason: "その品はありません" };
    // **持っていることを、世界が自分で確かめない。** 署名された言い分を
    // 検めた結果だけを見る。買い物の記録を世界が持つと、そこも守る対象になる。
    if (!mayPlace(who, wish.content)) return { ok: false, reason: "その品を置く権利がありません" };
    const bought = items.filter((one) => one.kind === "買った物").length;
    if (bought >= ITEM_LIMITS.boughtPerZone) {
      return { ok: false, reason: "ここに置ける買った物は、もういっぱいです" };
    }
    content = wish.content;
  }
  if (!Number.isFinite(wish.x) || !Number.isFinite(wish.z)) {
    return { ok: false, reason: "置けない場所です" };
  }
  const x = wish.x as number;
  const z = wish.z as number;
  const spec = CATALOGUE[wish.kind];

  if (items.length >= ITEM_LIMITS.perZone) return { ok: false, reason: "ここはもう物でいっぱいです" };
  const mineHere = items.filter((one) => one.owner === who);
  if (mineHere.length >= ITEM_LIMITS.perPerson) {
    return { ok: false, reason: `1つの区画に置けるのは${ITEM_LIMITS.perPerson}個までです` };
  }
  // **続けて置かせない。** 一度に何十個も送られると、上限まで一瞬で埋まる。
  const last = mineHere.reduce((newest, one) => Math.max(newest, one.at), 0);
  if (at - last < ITEM_LIMITS.cooldown) return { ok: false, reason: "少し待ってください" };

  if (Math.hypot(x - mine.x, z - mine.z) > ITEM_LIMITS.reach) {
    return { ok: false, reason: "手の届く所にしか置けません" };
  }
  // 縁の外へは置けない。**歩けない所に物があっても、誰も見ない。**
  if (Math.hypot(x, z) > ground.radius - spec.radius) return { ok: false, reason: "外には置けません" };
  if (ground.carved.some((one) => inside(one, x, z, spec.radius))) {
    return { ok: false, reason: "そこには置けません" };
  }
  if (items.some((one) => Math.hypot(x - one.x, z - one.z) < ITEM_LIMITS.gap)) {
    return { ok: false, reason: "物が近すぎます" };
  }

  const item: Item = {
    id: nextId(),
    kind: wish.kind,
    x, z,
    facing: Number.isFinite(wish.facing) ? (wish.facing as number) : 0,
    owner: who,
    // **書けない品目に文字を持たせない。** 持たせると、絵の側が出さないだけの
    // 「見えない文字」になり、検めの外に置き場ができる。
    text: spec.writable ? cleanSign(wish.text) : "",
    content,
    reports: [],
    at
  };
  return { ok: true, items: [...items, item], item };
}

/**
 * 隠れているか。**通報が届いた物は、誰にも見えなくする。**
 *
 * 消さずに隠す。消してしまうと、間違いだったときに戻せないし、
 * 何が起きたかも追えない。
 */
export function isHidden(item: Item): boolean {
  return item.reports.length >= ITEM_LIMITS.reportsToHide;
}

/** 見える物だけ。**配る前にここを通す。** */
export function visible(items: readonly Item[]): Item[] {
  return items.filter((one) => !isHidden(one));
}

export type Reported = { items: Item[]; changed: boolean };

/**
 * 通報する。
 *
 * **同じ人が何度押しても1つ。** 数で持つと、1人で消せる道具になる。
 * 自分の物は通報できない——押せても意味が無く、間違いのもとになる。
 */
export function report(items: readonly Item[], id: unknown, who: string): Reported {
  const found = items.find((one) => one.id === id);
  if (!found || found.owner === who || found.reports.includes(who)) {
    return { items: [...items], changed: false };
  }
  return {
    items: items.map((one) =>
      one === found ? { ...one, reports: [...one.reports, who] } : one),
    changed: true
  };
}

export type Removed = { items: Item[]; removed: Item | null };

/**
 * 片付ける。**置いた人だけ。**
 *
 * 誰でも片付けられると、通りすがりに街を消せる。区画の主や通報の扱いは、
 * 人が増えてから足す——**先に緩くすると、後から締められない。**
 */
export function remove(items: readonly Item[], id: unknown, who: string): Removed {
  const found = items.find((one) => one.id === id && one.owner === who) ?? null;
  if (!found) return { items: [...items], removed: null };
  return { items: items.filter((one) => one !== found), removed: found };
}

/** その人の物を全部片付ける。**世界から消えるときに使う場面がある。** */
export function removeAllOf(items: readonly Item[], who: string): Item[] {
  return items.filter((one) => one.owner !== who);
}

/**
 * 記録から読み直す。**壊れた行は捨てて、残りは使う。**
 *
 * 1行が読めないだけで区画の物が全部消えると、書き換えられた覚え書き1つで
 * 街が更地になる。
 */
export function readItems(raw: unknown, radius = Infinity): Item[] {
  if (!Array.isArray(raw)) return [];
  const found: Item[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const one = value as Record<string, unknown>;
    if (!isKind(one.kind)) continue;
    if (typeof one.id !== "string" || one.id.length === 0 || one.id.length > 64) continue;
    if (seen.has(one.id)) continue;
    if (typeof one.owner !== "string" || one.owner.length === 0 || one.owner.length > 160) continue;
    if (!Number.isFinite(one.x) || !Number.isFinite(one.z)) continue;
    // 名前の無い買った物は、絵の出しようがない。
    if (one.kind === "買った物" && !isContent(one.content)) continue;
    if (Math.hypot(one.x as number, one.z as number) > radius) continue;
    if (found.length >= ITEM_LIMITS.perZone) break;
    seen.add(one.id);
    found.push({
      id: one.id,
      kind: one.kind,
      x: one.x as number,
      z: one.z as number,
      facing: Number.isFinite(one.facing) ? (one.facing as number) : 0,
      owner: one.owner,
      text: CATALOGUE[one.kind].writable ? cleanSign(one.text) : "",
      // **形の違う名前を持ち越さない。** 記録は手で書き換えられる。
      content: one.kind === "買った物" && isContent(one.content) ? one.content : "",
      reports: Array.isArray(one.reports)
        ? [...new Set(one.reports.filter((who): who is string =>
            typeof who === "string" && who.length > 0 && who.length <= 160))]
          .slice(0, ITEM_LIMITS.reportsToHide * 4)
        : [],
      at: Number.isFinite(one.at) ? (one.at as number) : 0
    });
  }
  return found;
}
