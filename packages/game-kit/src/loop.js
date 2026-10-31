/**
 * 固定刻みの進行。
 *
 * 描画のフレーム間隔をそのまま計算に渡すと、速い端末と遅い端末で違う結果になる。
 * 端末の性能が勝敗に効くのは、対戦のあるゲームでは不具合。タブを裏に回して
 * 戻ったときに数秒ぶんの dt が一度に来て、判定をすり抜けるのも同じ理由で困る。
 *
 * だから**計算は固定の刻みで進め、余った時間は次に持ち越す**。描画だけが
 * 可変で走る。
 */

/** 1回の呼び出しで進める上限。ここを超えた分は捨てる（裏に回っていた間を早送りしない）。 */
const MAX_CATCH_UP_SECONDS = 0.25;

export function createLoop(stepSeconds, step) {
  if (!(stepSeconds > 0)) throw new Error("stepSeconds must be positive");
  let carried = 0;
  return {
    /**
     * 経過した実時間を渡す。固定刻みで step を必要な回数呼ぶ。
     * 戻り値は、次の刻みまでどれだけ進んでいるか（0〜1）。描画の補間に使う。
     */
    advance(elapsedSeconds) {
      carried += Math.min(Math.max(elapsedSeconds, 0), MAX_CATCH_UP_SECONDS);
      while (carried >= stepSeconds) {
        step(stepSeconds);
        carried -= stepSeconds;
      }
      return carried / stepSeconds;
    },
    /** テストと計測用。実時間を待たずに指定秒ぶん進める。 */
    runFor(seconds) {
      const steps = Math.round(seconds / stepSeconds);
      for (let index = 0; index < steps; index += 1) step(stepSeconds);
      return steps;
    }
  };
}
