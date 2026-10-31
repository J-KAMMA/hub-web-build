/**
 * Paid AI execution (x402 pay-per-use through the wallet) is switched off.
 * Owner decision 2026-10-15: 「AIの有料実行っていらない」.
 *
 * The code stays behind one flag so it can return without a rewrite.
 * Default is OFF. Set NEXT_PUBLIC_HUB_AI_PAID_EXECUTION=1 (flag name
 * HUB_AI_PAID_EXECUTION) at build time to show prices, paid-only models,
 * image/video generation and the wallet signature flow again.
 *
 * Free paths are unaffected: on-device AI, the connected PC (Local Runner),
 * bring-your-own-key, and the work (Pi) harness.
 */
export function paidAiExecutionEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_HUB_AI_PAID_EXECUTION;
  return value === "1" || value === "true";
}
