/**
 * 世界の規則。**サーバが持ち、描画を読まない。**
 *
 * Colyseus が与えてくれるのは部屋と状態同期であって、**規則は与えてくれない。**
 * 速度の上限も、境界も、定員も、自分で決めて自分で守らせる必要がある。それを
 * 部屋のハンドラに散らすと、確かめるのにサーバを起動しなければならなくなる。
 * ここに寄せておけば、関数を呼ぶだけで確かめられる。
 *
 * **位置を決めるのはサーバである。** クライアントが送るのは「こう動きたい」と
 * いう意思だけ。ここを逆にすると、誰でも瞬間移動できる世界になる。送られてきた
 * 座標をそのまま入れてはいけない。
 *
 * 伝送路（Colyseus / WebSocket / 何か別のもの）には依存しない。載せ替えても
 * 規則は変わらない。
 */

/** 平面上の位置。高さは地形から決まるので、ここでは持たない。 */
export type Spot = { x: number; z: number };

export type Avatar = {
  /** Hub Account に紐づく識別子。名前ではない。 */
  id: string;
  /** 表示名。**他人が書いた文字列**として扱う。指示でも印付けでもない。 */
  name: string;
  x: number;
  z: number;
  /** 向き。ラジアン。 */
  facing: number;
  /** 最後にこの人の意思を受け入れた時刻（ミリ秒）。 */
  movedAt: number;
  /**
   * 最後に**何かが届いた**時刻（ミリ秒）。
   *
   * 片付けの判断はこちらで行う。動いた時刻で判断すると、**立ち止まって
   * 話を聞いている人が幽霊として消される**（実測で、広場に立っていた自分が
   * 名簿から消えた）。世界に居ることと、歩いていることは別。
   */
  seenAt: number;
  /**
   * 姿。買った品の名前。**空なら、既定の住人の姿。**
   *
   * 世界は「この人が何を買ったか」を持たない。持っているのは、署名された
   * 言い分が一度通った、という結果だけ。接続が切れれば消える——`Allowed` と
   * 同じ考え方で、**買ったことの記録ではない**。
   */
  look: string;
};

import { freeSpot, slide, type Blocker } from "./collide";
import { solidOf, type Item } from "./items";

export type Zone = {
  id: string;
  /** 定員。**無制限にしない**——1部屋に無限に入れると、それだけで落とせる。 */
  capacity: number;
  /** 歩ける範囲。中心からの半径。 */
  radius: number;
  avatars: Avatar[];
  /**
   * 彫った街の、通れない場所。**動かない。**
   *
   * 置かれた物を消すたびにここまで作り直すと、どこかで彫った分を失う。
   */
  carved: Blocker[];
  /** 住んでいる人が置いた物。 */
  items: Item[];
  /**
   * 実際に通れない場所。**carved と items から作る。手で書き換えない。**
   *
   * 歩くたびに足し合わせると、1回の移動ごとに配列が1つ生まれる。物が変わった
   * ときにだけ作り直す。
   */
  blockers: Blocker[];
};

export const LIMITS = {
  /** 走る速さの上限（単位/秒）。これを超える移動は詰める。 */
  speed: 7,
  /**
   * 一度に信じる時間の上限（ミリ秒）。
   *
   * 接続が詰まって10秒ぶんまとめて届いたとき、10秒ぶん動かすと壁を抜ける。
   * **溜まった時間は捨てる。** 遅れた人が得をしない。
   */
  catchUp: 250,
  /** 表示名の長さ。長い名前は画面を壊す道具になる。 */
  nameLength: 24,
  /** 何も言ってこない人を片付けるまで（ミリ秒）。 */
  idle: 60_000,
  /** 既定の定員。負荷試験で決め直す前提の仮の数。 */
  capacity: 60
};

/**
 * 落とす見えない文字。
 *
 * **見えないものを全部落としてはいけない。** 0x200b〜0x200f を丸ごと落としたら、
 * 絵文字の接合子（U+200D）まで消えて 👩‍🚀 が2文字に割れた。接合子と非接合子は、
 * 絵文字にも多くの文字体系にも要る。
 *
 * 落とすのは、**幅を持たないか、並び順を偽れるもの**だけ:
 * 0x200b 幅なし空白 / 0x200e,0x200f 左右の印 / 0x202a-0x202e 埋め込みと上書き /
 * 0x2066-0x2069 分離。並び順を上書きできると、表示名で他人の名前を騙れる。
 */
const INVISIBLE = (code: number) =>
  code === 0x200b ||
  code === 0x200e || code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

/** 表示名を整える。**他人が書いた文字列**なので、そのまま通さない。 */
export function cleanName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return [...text]
    // 制御文字と、行を割る文字を落とす。名前で画面を壊せないようにする。
    .filter((one) => {
      const code = one.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !INVISIBLE(code);
    })
    .slice(0, LIMITS.nameLength)
    .join("")
    .trim();
}

export function emptyZone(
  id: string,
  options: Partial<Pick<Zone, "capacity" | "radius" | "carved" | "items">> = {}
): Zone {
  const carved = options.carved ?? [];
  const items = options.items ?? [];
  return {
    id,
    capacity: options.capacity ?? LIMITS.capacity,
    radius: options.radius ?? 60,
    avatars: [],
    carved,
    items,
    blockers: solidOf(carved, items)
  };
}

/**
 * 置かれた物を入れ替える。**通れない場所も一緒に作り直す。**
 *
 * 片方だけ更新できる形にすると、いつか片方だけ更新される——物が消えたのに
 * 通れないまま、という不具合はそこから来る。
 */
export function withItems(zone: Zone, items: Item[]): Zone {
  return { ...zone, items, blockers: solidOf(zone.carved, items) };
}

export type JoinResult =
  | { ok: true; zone: Zone; avatar: Avatar }
  | { ok: false; reason: "満員" | "名前が空" | "既に居る" };

/**
 * 入る。
 *
 * 同じ id で二重に入れない。**別の窓から入り直したときに分身が残ると、
 * 誰がどこに居るのか分からなくなる。**
 */
export function join(
  zone: Zone,
  who: { id: string; name: unknown },
  at: number,
  /** 前に居た場所。**境界の外なら内へ寄せる**——区画が縮んでいることがある。 */
  from: { x: number; z: number } | null = null
): JoinResult {
  const name = cleanName(who.name);
  if (!name) return { ok: false, reason: "名前が空" };
  if (zone.avatars.some((one) => one.id === who.id)) return { ok: false, reason: "既に居る" };
  if (zone.avatars.length >= zone.capacity) return { ok: false, reason: "満員" };

  let x = 0;
  let z = 0;
  if (from && Number.isFinite(from.x) && Number.isFinite(from.z)) {
    const out = Math.hypot(from.x, from.z);
    const scale = out > zone.radius ? zone.radius / out : 1;
    x = from.x * scale;
    z = from.z * scale;
  }
  // **塞がっていない場所へ降ろす。** 原点が空いているとは限らない。
  const spot = freeSpot(zone.blockers, { x, z }, zone.radius);
  const avatar: Avatar = {
    id: who.id, name, x: spot.x, z: spot.z, facing: 0, movedAt: at, seenAt: at, look: ""
  };
  return { ok: true, zone: { ...zone, avatars: [...zone.avatars, avatar] }, avatar };
}

/** 出る。居なくても静かに済ませる——切断は二重に届く。 */
/**
 * 姿を替える。
 *
 * **買ってよいかを、ここでは見ない。** 見るのは署名を検める側（`owned.ts`）で、
 * ここへ来るのは通った後の名前だけ。核に鍵を持たせないための分け方で、物を
 * 置くときと同じ。
 *
 * 居ない人には何もしない——**「居ないので姿を替えられません」と返さない。**
 * 誰が居るかを外から数える道具になるため。
 */
export function wear(zone: Zone, id: string, look: string): Zone {
  if (!zone.avatars.some((one) => one.id === id)) return zone;
  return {
    ...zone,
    avatars: zone.avatars.map((one) => (one.id === id ? { ...one, look } : one))
  };
}

export function leave(zone: Zone, id: string): Zone {
  return { ...zone, avatars: zone.avatars.filter((one) => one.id !== id) };
}

/**
 * 動きたいという意思を受ける。**そのまま入れない。**
 *
 * 経過時間から進める距離を出し、それを超える分は詰める。境界の外は内へ寄せる。
 * つまりクライアントは「どこへ向かいたいか」を言えるだけで、**どこに居るかは
 * サーバが決める。**
 */
export function intend(zone: Zone, id: string, want: { x: number; z: number; facing?: number }, at: number): Zone {
  const avatars = zone.avatars.map((one) => {
    if (one.id !== id) return one;

    // 数でないものが届くことがある。入れる前に弾く。
    const x = Number.isFinite(want.x) ? want.x : one.x;
    const z = Number.isFinite(want.z) ? want.z : one.z;

    // 溜まった時間は捨てる。遅れて届いた分をまとめて動かすと壁を抜ける。
    const passed = Math.min(Math.max(at - one.movedAt, 0), LIMITS.catchUp) / 1000;
    const allowed = LIMITS.speed * passed;

    const dx = x - one.x;
    const dz = z - one.z;
    const wanted = Math.hypot(dx, dz);
    const scale = wanted > allowed && wanted > 0 ? allowed / wanted : 1;

    // **壁はサーバが見る。** 客側で止めても、止めない客を書けば抜けられる。
    const past = slide(zone.blockers, { x: one.x, z: one.z }, { x: one.x + dx * scale, z: one.z + dz * scale });
    let nextX = past.x;
    let nextZ = past.z;

    // 境界。外へ出ようとしたら、縁に沿わせる。跳ね返さない——引っかかって見える。
    const out = Math.hypot(nextX, nextZ);
    if (out > zone.radius) {
      nextX = (nextX / out) * zone.radius;
      nextZ = (nextZ / out) * zone.radius;
    }

    const facing = Number.isFinite(want.facing) ? (want.facing as number) : one.facing;
    return { ...one, x: nextX, z: nextZ, facing, movedAt: at, seenAt: at };
  });

  return { ...zone, avatars };
}

/**
 * 黙ったままの人を片付ける。
 *
 * 切断が届かないことがある。**居ないのに居ることになっている人**が溜まると、
 * 定員が埋まって誰も入れなくなる。
 */
export function sweep(zone: Zone, at: number): Zone {
  return { ...zone, avatars: zone.avatars.filter((one) => at - one.seenAt < LIMITS.idle) };
}

/** 送り出す形。**内部の時刻は渡さない**——要らないものを外へ出さない。 */
export function snapshot(zone: Zone): Array<Omit<Avatar, "movedAt" | "seenAt">> {
  return zone.avatars.map(({ movedAt: _movedAt, seenAt: _seenAt, ...rest }) => rest);
}

/** 便りがあったことだけを記録する。**歩いていなくても、居る。** */
export function heard(zone: Zone, id: string, at: number): Zone {
  return {
    ...zone,
    avatars: zone.avatars.map((one) => (one.id === id ? { ...one, seenAt: at } : one))
  };
}
