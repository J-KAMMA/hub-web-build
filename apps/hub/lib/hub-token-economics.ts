export type HubTokenEconomicsInput = {
  grossRevenue: number;
  discount: number;
  cashback: number;
  referralReward: number;
  subsidy: number;
  hubPaidProcessingCost: number;
  ethJpy: number;
  benefitCostRate: number;
};

export function simulateHubTokenEconomics(input: HubTokenEconomicsInput) {
  const values = Object.values(input);
  if (values.some((value)=>!Number.isFinite(value)||value<0)
    || input.ethJpy<=0 || input.benefitCostRate>1) throw new Error("invalid_hub_token_economics");
  const deductions = input.discount+input.cashback+input.referralReward+input.subsidy+input.hubPaidProcessingCost;
  const netRevenue = Math.max(0,input.grossRevenue-deductions);
  const ethRevenue = netRevenue/input.ethJpy;
  const issuedHub = Math.floor(ethRevenue*1_000_000);
  const maximumBenefitCost = netRevenue*input.benefitCostRate;
  return {deductions,netRevenue,ethRevenue,issuedHub,maximumBenefitCost,
    marginAfterBenefit:netRevenue-maximumBenefitCost};
}
