/**
 * 2次元のベクトル。
 *
 * ゲームごとに書き直していたので揃える。3次元が要るのは描画側だけで、
 * 盤面や試合の計算は平面で足りることがほとんど。高さが要るときは
 * 別に1つ持たせるほうが、判定が読みやすい。
 */
export const vec = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const length = (a) => Math.hypot(a.x, a.y);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a, b) => a.x * b.x + a.y * b.y;

export function normalise(a) {
  const size = length(a);
  return size < 1e-6 ? { x: 0, y: 0 } : { x: a.x / size, y: a.y / size };
}

export const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

/** 0→1 を low→high に写す。能力値から係数を作るのに何度も要る。 */
export const lerp = (low, high, t) => low + (high - low) * clamp(t, 0, 1);

/** 線分 a→b に対する点 p の最短距離。経路上に誰かいるかの判定に使う。 */
export function distanceToSegment(p, a, b) {
  const along = sub(b, a);
  const span = length(along);
  if (span < 1e-6) return distance(p, a);
  const t = clamp(dot(sub(p, a), along) / (span * span), 0, 1);
  return distance(p, { x: a.x + along.x * t, y: a.y + along.y * t });
}
