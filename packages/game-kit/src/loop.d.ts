export type Loop = {
  /** 経過した実時間（秒）を渡す。戻り値は次の刻みまでの進み具合（0〜1）。 */
  advance(elapsedSeconds: number): number;
  /** 実時間を待たずに指定秒ぶん進める。テストと計測用。 */
  runFor(seconds: number): number;
};
export declare function createLoop(stepSeconds: number, step: (dt: number) => void): Loop;
