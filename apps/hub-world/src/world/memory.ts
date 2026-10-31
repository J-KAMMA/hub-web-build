/**
 * 居た場所を憶えておく。**入り直したら、そこから続く。**
 *
 * 毎回いつも広場の中央に立たされると、世界に住んでいる感じにならない。
 * 憶えるのは今のところ「どの区画の、どこに居たか」だけ。持ち物も服も、
 * まだ無いので憶えない。
 *
 * ここは読み書きの手段を知らない。**渡された記録を検めて、新しい記録を返す
 * だけ。** ファイルでも、鍵付きの保管庫でも、後で替えられる。
 *
 * **読み込むものを信じない。** 手で書き換えられる場所に置くので、壊れた記録も
 * 悪意のある記録も届く前提で検める。
 */

export type LastSeen = {
  zone: string;
  x: number;
  z: number;
  /** 最後に居た時刻（ミリ秒）。古いものを捨てるのに使う。 */
  at: number;
};

export type Remembered = Map<string, LastSeen>;

export const MEMORY = {
  /** 憶えておく人数の上限。**無制限にしない**——増え続けると読み書きが重くなる。 */
  people: 20_000,
  /** これより古い記録は捨てる（ミリ秒）。90日。 */
  keep: 90 * 24 * 60 * 60 * 1000
};

export function empty(): Remembered {
  return new Map();
}

/**
 * 場所を憶える。**写さずに書き換える。**
 *
 * 呼ぶたびに丸ごと写していたら、2万人ぶんで書き込み1回が2万回の複写になり、
 * テストが20秒で落ちた。本番でも同じで、30秒ごとに人数ぶん呼ばれる。
 * ここは世界の状態ではなく保管庫なので、写す理由が無い。
 */
export function remember(all: Remembered, id: string, spot: Omit<LastSeen, "at">, at: number): Remembered {
  if (!id || !Number.isFinite(spot.x) || !Number.isFinite(spot.z) || !spot.zone) return all;
  all.set(id, { zone: spot.zone, x: spot.x, z: spot.z, at });
  return all;
}

/** 前に居た場所。知らない人なら null。 */
export function recall(all: Remembered, id: string): LastSeen | null {
  return all.get(id) ?? null;
}

/**
 * 古いものと、溢れたぶんを捨てる。
 *
 * **捨てないと増え続ける。** 一度来ただけの人を永久に憶えておく理由が無い。
 * 溢れたときは、古い順に捨てる。
 */
export function prune(all: Remembered, at: number): Remembered {
  const alive = [...all.entries()].filter(([, spot]) => at - spot.at < MEMORY.keep);
  alive.sort((a, b) => b[1].at - a[1].at);
  return new Map(alive.slice(0, MEMORY.people));
}

/** 書き出す形。 */
export function toRecord(all: Remembered): Record<string, LastSeen> {
  return Object.fromEntries(all);
}

/**
 * 読み込む。**壊れていても落ちない。**
 *
 * 手で書き換えられる場所に置くので、数でない座標も、知らない区画も、
 * 途方もない値も届く前提。**通らないものは黙って落とす**——1件のせいで
 * 全員の記録を失うほうが困る。
 */
export function fromRecord(raw: unknown, zones: readonly string[]): Remembered {
  const all = empty();
  if (typeof raw !== "object" || raw === null) return all;
  const known = new Set(zones);

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || id.length === 0 || id.length > 200) continue;
    if (typeof value !== "object" || value === null) continue;
    const spot = value as Partial<LastSeen>;
    if (typeof spot.zone !== "string" || !known.has(spot.zone)) continue;
    if (!Number.isFinite(spot.x) || !Number.isFinite(spot.z) || !Number.isFinite(spot.at)) continue;
    // 途方もない座標は、そこへ置き直すと世界の外に立つことになる。
    if (Math.abs(spot.x as number) > 10_000 || Math.abs(spot.z as number) > 10_000) continue;
    all.set(id, { zone: spot.zone, x: spot.x as number, z: spot.z as number, at: spot.at as number });
  }
  return all;
}
