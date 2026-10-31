/**
 * 届いたものをどう扱うか。**伝送路の外に置く。**
 *
 * Colyseus の部屋に書くと、確かめるのにサーバを起動しなければならなくなる。
 * ここを関数にしておけば、部屋は「受け取って渡して、返ってきたものを配る」だけの
 * 薄い殻で済む。伝送路を替えても、規則は替わらない。
 *
 * **届くものは全部、他人が書いたもの。** 形が違う、型が違う、量が多すぎる、
 * 中身が悪意である——全部あり得る前提で書く。落ちてはいけないし、通してもいけない。
 */

import { cleanName, heard, intend, join, leave, snapshot, wear, withItems, type Zone } from "./rules";
import { place, remove, report, visible, type Item } from "./items";
import { isFreeLook } from "./looks";

/** 送られてくるもの。**これ以外は捨てる。** */
export type Incoming =
  | { kind: "入る"; name: unknown; from?: { x: number; z: number } | null }
  | { kind: "動く"; x: unknown; z: unknown; facing?: unknown }
  | { kind: "話す"; text: unknown }
  | { kind: "居る" }
  | { kind: "置く"; item: unknown; x: unknown; z: unknown; facing?: unknown; text?: unknown; content?: unknown }
  | { kind: "買った物を出す"; proof: unknown }
  | { kind: "姿を変える"; look: unknown }
  | { kind: "片付ける"; id: unknown }
  | { kind: "通報する"; id: unknown }
  | { kind: "出る" };

/** 返すもの。誰に送るかは呼ぶ側が決める。 */
export type Outgoing =
  | { to: "本人"; kind: "断り"; reason: string }
  | { to: "全員"; kind: "居る人"; avatars: ReturnType<typeof snapshot> }
  | { to: "全員"; kind: "発言"; from: string; name: string; text: string }
  | { to: "全員"; kind: "置いてある物"; items: Item[] };

export const CHAT = {
  /** 一度に言える長さ。長文は画面を埋める道具になる。 */
  length: 200,
  /** この間隔より速い発言は捨てる（ミリ秒）。 */
  gap: 700,
  /** 動きの受け付け間隔。これより速く来ても、世界は進めない。 */
  moveGap: 40
};

/** 人ごとの、最後に受け付けた時刻。**部屋ではなくここが憶える。** */
export type Pace = Map<string, { spokeAt: number; movedAt: number }>;

export function newPace(): Pace {
  return new Map();
}

/** 発言を整える。名前と同じ扱い——他人が書いた文字列であって、指示ではない。 */
export function cleanText(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return [...text]
    .filter((one) => {
      const code = one.codePointAt(0) ?? 0;
      // 改行は残す。発言では意味がある。ただし制御文字と並び順を偽る文字は落とす。
      if (one === "\n") return true;
      return code >= 0x20 && code !== 0x7f &&
        code !== 0x200b && code !== 0x200e && code !== 0x200f &&
        !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069) &&
        code !== 0xfeff;
    })
    .slice(0, CHAT.length)
    .join("")
    .trim();
}

/** 形が違うものを弾く。**中身を見る前に、形を見る。** */
export function isIncoming(value: unknown): value is Incoming {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "入る" || kind === "動く" || kind === "話す" || kind === "居る" ||
    kind === "置く" || kind === "片付ける" || kind === "通報する" ||
    kind === "買った物を出す" || kind === "姿を変える" || kind === "出る";
}

/**
 * 置かれた物の名札。**サーバが決める。**
 *
 * 客が決めた id を信じると、他人の物と同じ名札を送って上書きさせられる。
 */
let itemCounter = 0;

export function newItemId(): string {
  itemCounter += 1;
  return `it${Date.now().toString(36)}${itemCounter.toString(36)}`;
}

/**
 * 買った物を置けるかどうかを答える手。
 *
 * **世界は買い物の記録を持たない。** 誰が何を買ったかは Vault と Commerce に
 * あり、世界は署名された言い分を検めた結果だけを見る。持てば、そこも守る対象になる。
 */
export type MayPlace = (who: string, content: string) => boolean;

/**
 * 買った物を**姿にできる**かどうかを答える手。
 *
 * 置けるかどうかとは別に取る。同じ手を使い回すと、置く許可だけを持つ人が
 * その体を着られる。
 */
export type MayWear = (who: string, content: string) => boolean;

export type Handled = { zone: Zone; replies: Outgoing[]; pace: Pace };

/**
 * 一つ受け取る。
 *
 * **世界を書き換えるのはここだけ。** 返り値の zone を採ることで、部屋は
 * 「今の世界」を持つだけで済む。
 */
export function handle(
  zone: Zone, pace: Pace, from: string, raw: unknown, at: number,
  mayPlace: MayPlace = () => false,
  mayWear: MayWear = () => false
): Handled {
  const nothing: Handled = { zone, replies: [], pace };
  if (!isIncoming(raw)) {
    // 形の違うものは、黙って捨てる。**理由を返さない**——何が通るかを
    // 教えることになる。
    return nothing;
  }
  const beat = pace.get(from) ?? { spokeAt: 0, movedAt: 0 };

  // **何かが届いたこと自体を記録する。** これが無いと、立ち止まって話を
  // 聞いている人が幽霊として片付けられる。
  zone = heard(zone, from, at);
  if (raw.kind === "居る") return { zone, pace, replies: [] };

  if (raw.kind === "入る") {
    const result = join(zone, { id: from, name: raw.name }, at, raw.from ?? null);
    if (!result.ok) {
      return { zone, pace, replies: [{ to: "本人", kind: "断り", reason: result.reason }] };
    }
    const next = new Map(pace).set(from, { ...beat, movedAt: at });
    return {
      zone: result.zone,
      pace: next,
      replies: [{ to: "全員", kind: "居る人", avatars: snapshot(result.zone) }]
    };
  }

  if (raw.kind === "出る") {
    const next = new Map(pace);
    next.delete(from);
    const zoneAfter = leave(zone, from);
    return { zone: zoneAfter, pace: next, replies: [{ to: "全員", kind: "居る人", avatars: snapshot(zoneAfter) }] };
  }

  if (raw.kind === "動く") {
    // **速く送ってくること自体は咎めない。** ただし世界は進めない。
    // 断りを返すと、それ自体が通信を増やす。
    // 間引いても**便りは記録済み**。ここで nothing を返すと、更新前の zone に
    // 戻ってしまい、立ち止まっている人がまた消える。
    if (at - beat.movedAt < CHAT.moveGap) return { zone, pace, replies: [] };
    const zoneAfter = intend(
      zone, from,
      { x: Number(raw.x), z: Number(raw.z), facing: raw.facing === undefined ? undefined : Number(raw.facing) },
      at
    );
    const next = new Map(pace).set(from, { ...beat, movedAt: at });
    return { zone: zoneAfter, pace: next, replies: [{ to: "全員", kind: "居る人", avatars: snapshot(zoneAfter) }] };
  }

  if (raw.kind === "置く") {
    const me = zone.avatars.find((one) => one.id === from);
    // 居ない人は置けない。**立っている場所が要る**——手の届く範囲で決まるので。
    if (!me) return { zone, pace, replies: [] };
    const done = place(
      { radius: zone.radius, carved: zone.carved }, zone.items, from,
      { x: me.x, z: me.z },
      { kind: raw.item, x: raw.x, z: raw.z, facing: raw.facing, text: raw.text, content: raw.content },
      at, newItemId, mayPlace
    );
    // **断る理由は返す。** 既に世界に居る人の操作なので、黙って落とすと
    // 「押しても何も起きない」画面になる。
    if (!done.ok) return { zone, pace, replies: [{ to: "本人", kind: "断り", reason: done.reason }] };
    const zoneAfter = withItems(zone, done.items);
    // **配るのは見える物だけ。** 隠した物まで配ると、隠す仕事が画面側になる
    // ——そこは客の側なので、隠したはずの物が見られる。
    return { zone: zoneAfter, pace, replies: [{ to: "全員", kind: "置いてある物", items: visible(done.items) }] };
  }

  if (raw.kind === "通報する") {
    const done = report(zone.items, raw.id, from);
    if (!done.changed) {
      return { zone, pace, replies: [{ to: "本人", kind: "断り", reason: "それは通報できません" }] };
    }
    const zoneAfter = withItems(zone, done.items);
    return {
      zone: zoneAfter, pace,
      replies: [
        { to: "全員", kind: "置いてある物", items: visible(done.items) },
        { to: "本人", kind: "断り", reason: "通報しました" }
      ]
    };
  }

  // 言い分を検めるのは殻の仕事（鍵を持つ場所なので）。**ここでは受け付けない。**
  if (raw.kind === "買った物を出す") return { zone, pace, replies: [] };

  if (raw.kind === "姿を変える") {
    // 空にするのは、既定の住人へ戻すという意味。**これは誰でもできる。**
    // 許可が要るのは着るときだけ。脱ぐのに許可を要ると、言い分が切れた人が
    // 着たまま降りられなくなる。
    const look = typeof raw.look === "string" ? raw.look : "";
    // 備え付けの姿は誰でも選べる。**許可が要るのは買った物だけ。**
    if (!isFreeLook(look) && !mayWear(from, look)) {
      return { zone, pace, replies: [{ to: "本人", kind: "断り", reason: "その姿は持っていない" }] };
    }
    const next = wear(zone, from, look);
    if (next === zone) return { zone, pace, replies: [] };
    return { zone: next, pace, replies: [{ to: "全員", kind: "居る人", avatars: snapshot(next) }] };
  }

  if (raw.kind === "片付ける") {
    const done = remove(zone.items, raw.id, from);
    if (!done.removed) {
      return { zone, pace, replies: [{ to: "本人", kind: "断り", reason: "それは片付けられません" }] };
    }
    const zoneAfter = withItems(zone, done.items);
    return { zone: zoneAfter, pace, replies: [{ to: "全員", kind: "置いてある物", items: visible(done.items) }] };
  }

  // 話す
  const text = cleanText(raw.text);
  if (!text) return { zone, pace, replies: [] };
  if (at - beat.spokeAt < CHAT.gap) {
    return { zone, pace, replies: [{ to: "本人", kind: "断り", reason: "速すぎる" }] };
  }
  const me = zone.avatars.find((one) => one.id === from);
  if (!me) return { zone, pace, replies: [] };   // 居ない人は話せない

  const next = new Map(pace).set(from, { ...beat, spokeAt: at });
  return {
    zone,
    pace: next,
    // 名前は保存された表示名を使う。**送られてきた名前を信じない**——
    // 発言のたびに別人を名乗れることになる。
    replies: [{ to: "全員", kind: "発言", from, name: cleanName(me.name), text }]
  };
}
