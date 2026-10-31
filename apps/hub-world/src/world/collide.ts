/**
 * 通れない場所。**判断はサーバでする。**
 *
 * 客側で止めても、通り抜けは直らない——止めない客を書けばよいだけなので。
 * 位置を決めるのがサーバである以上、壁もサーバが持つ。
 *
 * 形は `tools/blender/build_zones.py` が街と一緒に書き出す。**手で書かない**——
 * 建物を動かしたときに必ず食い違い、壁を抜けるか、何も無い所で止まる。
 *
 * **止めるのではなく、沿わせる。** 壁にぶつかるたびに動きが0になると、
 * 引っかかって進めない。当たった向きの成分だけを消して、残りは進める。
 */

export type Blocker =
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "box"; x: number; y: number; width: number; depth: number; turn: number };

/** 人の太さ。これを見ないと、壁に半分めり込んで立つ。 */
export const BODY = 0.45;

/** 読み込むものを信じない。壊れた1件で全部を捨てない。 */
export function readBlockers(raw: unknown): Blocker[] {
  if (!Array.isArray(raw)) return [];
  const found: Blocker[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const one = value as Record<string, unknown>;
    const numbers = (...keys: string[]) => keys.every((key) => Number.isFinite(one[key]));
    if (one.kind === "circle" && numbers("x", "y", "radius")) {
      found.push({ kind: "circle", x: one.x as number, y: one.y as number, radius: one.radius as number });
    } else if (one.kind === "box" && numbers("x", "y", "width", "depth", "turn")) {
      found.push({
        kind: "box",
        x: one.x as number, y: one.y as number,
        width: one.width as number, depth: one.depth as number, turn: one.turn as number
      });
    }
  }
  return found;
}

/** その点が塞がっているか。人の太さぶん膨らませて見る。 */
export function blocked(blockers: readonly Blocker[], x: number, z: number, body = BODY): boolean {
  for (const one of blockers) {
    if (one.kind === "circle") {
      if (Math.hypot(x - one.x, z - one.y) < one.radius + body) return true;
      continue;
    }
    // 長方形は、その向きへ座標を回してから比べる。
    const dx = x - one.x;
    const dz = z - one.y;
    const cos = Math.cos(-one.turn);
    const sin = Math.sin(-one.turn);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    if (Math.abs(localX) < one.width / 2 + body && Math.abs(localZ) < one.depth / 2 + body) return true;
  }
  return false;
}

/**
 * 経路を刻む幅。**壁の厚みより細かく。**
 *
 * 行き先だけを見ると、薄い壁を飛び越えて向こう側に着地できる（実測で、
 * 厚さ1の壁を z=0 から z=6 へ一息に抜けた）。詰まった接続からは一度に
 * 1.75 まで届くので、必ず途中を見る。
 */
export const STEP = 0.2;

/**
 * 塞がれるまで進む。**沿わせない。**
 *
 * 刻んで進むだけの部品。沿わせる処理をここに混ぜると、行き止まりで同じ点から
 * 呼び直し続けて止まらなくなる（実測で、呼び出しの深さが尽きた）。
 */
function walk(
  blockers: readonly Blocker[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  body: number
): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dz);
  if (span === 0) return { x: from.x, z: from.z };

  const steps = Math.max(1, Math.ceil(span / STEP));
  let last = { x: from.x, z: from.z };
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    const spot = { x: from.x + dx * ratio, z: from.z + dz * ratio };
    if (blocked(blockers, spot.x, spot.z, body)) return last;
    last = spot;
  }
  return last;
}

const moved = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) > 1e-9;

/**
 * そこまで動かす。**塞がれていたら、沿わせる。**
 *
 * 当たったら止める作りだと、壁に触れた瞬間に一切動けなくなり、隅で詰まる。
 * 縦と横を別々に試して、通れるほうだけ進める——壁に沿って歩ける。
 *
 * 元の場所が既に塞がっていても、押し出さない。**押し出すと、壁の向こう側へ
 * 弾き出すことがある。**
 */
export function slide(
  blockers: readonly Blocker[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  body = BODY
): { x: number; z: number } {
  if (blockers.length === 0) return to;

  const straight = walk(blockers, from, to, body);
  if (straight.x === to.x && straight.z === to.z) return straight;
  if (!moved(straight, from)) {
    // まっすぐは進めなかった。縦と横を別々に試す。
    const sideways = walk(blockers, from, { x: to.x, z: from.z }, body);
    if (moved(sideways, from)) return sideways;
    const forward = walk(blockers, from, { x: from.x, z: to.z }, body);
    if (moved(forward, from)) return forward;
    return { x: from.x, z: from.z };
  }
  return straight;
}

/**
 * 降り立てる場所を探す。
 *
 * **原点が空いているとは限らない。** 広場の中央には塔が立っていて、そこへ
 * 降ろすと壁の中で身動きが取れなくなる（実測で、120回動かして1歩も進めなかった）。
 *
 * 近いところから外へ広げて探す。見つからなければ、諦めて元の場所を返す
 * ——入れないよりましなので。
 */
export function freeSpot(
  blockers: readonly Blocker[],
  near: { x: number; z: number },
  radius: number,
  body = BODY
): { x: number; z: number } {
  if (!blocked(blockers, near.x, near.z, body)) return near;

  // 黄金角で外へ広げる。輪ごとに向きが変わるので、同じ方向ばかり探さない。
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let step = 1; step <= 240; step += 1) {
    const out = Math.min(radius * 0.9, step * 0.6);
    const angle = step * golden;
    const spot = { x: near.x + Math.cos(angle) * out, z: near.z + Math.sin(angle) * out };
    if (Math.hypot(spot.x, spot.z) > radius) continue;
    if (!blocked(blockers, spot.x, spot.z, body)) return spot;
  }
  return near;
}
