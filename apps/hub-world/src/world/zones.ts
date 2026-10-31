/**
 * 区画の定義。**様式を一つに決め打ちしない。**
 *
 * この世界は最終的に、現代都市も、近未来も、幻想も、利用者が作った世界も
 * 抱える。だから「地面と空と建物の様式」は世界の性質ではなく、**区画の性質**
 * として持つ。ここを固定して地面を作ると、二つ目の様式が要ったときに、地面から
 * 作り直すことになる。
 *
 * 描画を読まない。**何を描くかは決めるが、どう描くかは決めない。**
 */

/** 様式。区画ごとに変わる。増える前提で、絵の側と名前で結ぶ。 */
export type Style = "都会" | "牧歌" | "森" | "浜" | "現代都市" | "近未来" | "幻想" | "自作";

export type ZoneSpec = {
  id: string;
  /** 表示名。利用者に見せる。 */
  title: string;
  style: Style;
  /** 歩ける半径。 */
  radius: number;
  /** 定員。**区画ごとに違ってよい**——広場と店では収まる人数が違う。 */
  capacity: number;
  /**
   * 隣。**行き先が無い区画を作らない。** 入ったら出られること。
   * 相手側にもこちらが書かれているかは `zonesAreMutual` で確かめる。
   */
  exits: string[];
};

/**
 * 最初の地方。**街から始まり、外へ出ると土地が変わる。**
 *
 * 始まりを街にする。人が集まる場所が最初に来ないと、誰にも会わないまま
 * 出て行かれる。街を出ると草の道があり、その先に森と浜がある。
 *
 * **絵柄は変えない。** 都会でも、写した灰色には戻さない——同じ地方の中で
 * 絵の作りが変わると、繋がった土地に見えなくなる。
 *
 * 生き物は出さない。**居るのは人だけ。** この世界の見所は、居合わせた誰かで
 * あって、拾える何かではない。
 */
export const CITY_LAYOUT = "street-v4";

export const HUB_CITY: ZoneSpec[] = [
  {
    id: "city",
    title: "交流広場",
    style: "都会",
    radius: 55,
    capacity: 70,
    exits: ["route", "shore"]
  },
  {
    id: "route",
    title: "一番道路",
    style: "牧歌",
    radius: 55,
    capacity: 40,
    exits: ["city", "forest"]
  },
  {
    id: "forest",
    title: "木もれ日の森",
    style: "森",
    radius: 40,
    capacity: 30,
    exits: ["route"]
  },
  {
    id: "shore",
    title: "浜辺",
    style: "浜",
    radius: 50,
    capacity: 35,
    exits: ["city"]
  }
];

export function findZone(specs: readonly ZoneSpec[], id: string): ZoneSpec | undefined {
  return specs.find((one) => one.id === id);
}

/** 行き先が実在するか。**押しても何も起きない扉を作らない。** */
export function danglingExits(specs: readonly ZoneSpec[]): Array<{ from: string; to: string }> {
  const known = new Set(specs.map((one) => one.id));
  return specs.flatMap((one) =>
    one.exits.filter((exit) => !known.has(exit)).map((exit) => ({ from: one.id, to: exit }))
  );
}

/**
 * 片道になっている扉。
 *
 * 入れるのに出られない区画は、**迷子を作る**。片道にすること自体はあり得る
 * （落とし穴、一方通行の演出）ので、禁じるのではなく、一覧にして意図かどうかを
 * 見えるようにする。
 */
export function oneWayExits(specs: readonly ZoneSpec[]): Array<{ from: string; to: string }> {
  const at = new Map(specs.map((one) => [one.id, one]));
  return specs.flatMap((one) =>
    one.exits
      .filter((exit) => {
        const other = at.get(exit);
        return other ? !other.exits.includes(one.id) : false;
      })
      .map((exit) => ({ from: one.id, to: exit }))
  );
}

/** どの区画からも歩いて辿り着けるか。**孤立した区画は、誰にも見つからない。** */
export function unreachableFrom(specs: readonly ZoneSpec[], start: string): string[] {
  const at = new Map(specs.map((one) => [one.id, one]));
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const here = queue.shift()!;
    if (seen.has(here)) continue;
    seen.add(here);
    for (const exit of at.get(here)?.exits ?? []) {
      if (!seen.has(exit) && at.has(exit)) queue.push(exit);
    }
  }
  return specs.map((one) => one.id).filter((id) => !seen.has(id));
}
