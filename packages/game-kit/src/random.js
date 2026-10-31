/**
 * 決定的な乱数。
 *
 * ゲームが「同じ入力なら同じ結果」を約束できないと、対戦の検証も、不具合の
 * 再現も、テストもできない。`Math.random` を使った時点でそれが全部消える。
 *
 * mulberry32。状態は32bit1つで足り、分布もこの用途には十分。
 */
export class Rng {
  #state;

  constructor(seed) {
    // 0 は自分自身を出し続けるので避ける。
    this.#state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }

  /** 0以上1未満。 */
  next() {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** low以上high未満。 */
  between(low, high) {
    return low + this.next() * (high - low);
  }

  /** 確率 chance で真。 */
  chance(chance) {
    return this.next() < chance;
  }

  /** 配列から1つ。空なら undefined。 */
  pick(items) {
    return items.length === 0 ? undefined : items[Math.floor(this.next() * items.length)];
  }

  /**
   * 平均0の左右対称なぶれ。狙いをずらすのに使う。
   *
   * 一様分布ではなく2つの平均。大外しが一様に出ると偶然だらけに見えるので、
   * 中心を厚くして「たまに大きく外す」にする。
   */
  spread(size) {
    return (this.next() + this.next() - 1) * size;
  }
}
