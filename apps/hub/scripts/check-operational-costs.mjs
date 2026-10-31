const currentUsd = Number(process.env.HUB_MONTHLY_COST_USD ?? 0);
const budgetUsd = Number(process.env.HUB_MONTHLY_COST_BUDGET_USD ?? 0);
const warningRatio = Number(process.env.HUB_COST_WARNING_RATIO ?? 0.8);

const configured =
  Number.isFinite(currentUsd) &&
  Number.isFinite(budgetUsd) &&
  currentUsd >= 0 &&
  budgetUsd > 0 &&
  Number.isFinite(warningRatio) &&
  warningRatio > 0 &&
  warningRatio <= 1;

const ratio = configured ? currentUsd / budgetUsd : 0;
const status = !configured
  ? "not_configured"
  : ratio >= 1
    ? "over_budget"
    : ratio >= warningRatio
      ? "warning"
      : "ok";

console.log(JSON.stringify({
  healthy: status === "ok" || status === "not_configured",
  configured,
  status,
  currentUsd: configured ? Number(currentUsd.toFixed(4)) : null,
  budgetUsd: configured ? Number(budgetUsd.toFixed(4)) : null,
  usageRatioBps: configured ? Math.round(ratio * 10_000) : null,
  checkedAt: new Date().toISOString(),
}));

if (status === "warning" || status === "over_budget") process.exitCode = 1;
