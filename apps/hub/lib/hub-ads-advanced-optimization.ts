export type PacingMode="even"|"asap";
export type OptimizationGoal="viewable"|"click"|"conversion";
export const HUB_AD_MAXIMUM_NEGATIVE_RATE=.02;
export const HUB_AD_MAXIMUM_DENSITY=.125;

export type DeliverySimulationInput={
  budgetJpyMicros:number; rateJpyMicros:number; days:number; pacingMode:PacingMode;
  estimatedDailyOpportunities:number; expectedViewability:number; expectedCtr:number; expectedConversionRate:number;
};
export type DeliverySimulation={estimatedServed:number;estimatedViewable:number;estimatedClicks:number;estimatedConversions:number;estimatedSpendJpyMicros:number;estimatedDepletionDays:number|null;dailyPlan:number[]};

const bounded=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));

export function simulateHubAdDelivery(input:DeliverySimulationInput):DeliverySimulation{
  const days=Math.round(bounded(input.days,1,366));
  const unitCost=Math.max(1,input.rateJpyMicros/1000);
  const budget=Math.max(0,input.budgetJpyMicros);
  const maxViewable=Math.floor(budget/unitCost);
  const viewability=bounded(input.expectedViewability,.05,1),ctr=bounded(input.expectedCtr,0,1),conversion=bounded(input.expectedConversionRate,0,1);
  const opportunityViewable=Math.floor(Math.max(0,input.estimatedDailyOpportunities)*days*viewability);
  const estimatedViewable=Math.min(maxViewable,opportunityViewable);
  const estimatedServed=Math.ceil(estimatedViewable/viewability);
  const estimatedSpendJpyMicros=Math.min(budget,Math.round(estimatedViewable*unitCost));
  const weights=Array.from({length:days},(_,index)=>input.pacingMode==="asap"?Math.pow(.88,index):1);
  const total=weights.reduce((sum,value)=>sum+value,0);
  const dailyPlan=weights.map((weight)=>Math.round(estimatedSpendJpyMicros*weight/total));
  return {estimatedServed,estimatedViewable,estimatedClicks:Math.round(estimatedViewable*ctr),estimatedConversions:Math.round(estimatedViewable*ctr*conversion),estimatedSpendJpyMicros,
    estimatedDepletionDays:estimatedSpendJpyMicros>=budget&&budget>0?Math.max(1,dailyPlan.findIndex((_,index)=>dailyPlan.slice(0,index+1).reduce((a,b)=>a+b,0)>=budget)+1):null,dailyPlan};
}

export function pacingMultiplier(mode:PacingMode,expectedRatio:number,actualRatio:number){
  const gap=bounded(expectedRatio-actualRatio,-1,1);
  if(mode==="asap")return 1.3;
  return bounded(1+gap*.5,.5,1.5);
}

export function experimentMultiplier(input:{requestId:string;creativeId:string;served:number;successes:number;totalCreativeServed:number;explorationPercent:number}){
  const evidence=Math.min(1,input.served/1000),rate=(input.successes+2)/(input.served+100);
  let hash=2166136261;for(const char of `${input.requestId}:${input.creativeId}`){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  const explore=(hash>>>0)%100<input.explorationPercent;
  const fairness=input.totalCreativeServed>0?Math.min(1.25,Math.sqrt(input.totalCreativeServed/Math.max(1,input.served))):1;
  return explore?fairness:bounded(1+evidence*(rate-.02)*8,.65,1.5);
}

export function experienceGuardrail(input:{negativeRate:number;slowRate:number;adDensity:number}){
  if(input.adDensity>HUB_AD_MAXIMUM_DENSITY*1.5||input.negativeRate>HUB_AD_MAXIMUM_NEGATIVE_RATE*2||input.slowRate>.2)return 0;
  return bounded(Math.min(HUB_AD_MAXIMUM_DENSITY/Math.max(.001,input.adDensity),HUB_AD_MAXIMUM_NEGATIVE_RATE/Math.max(.001,input.negativeRate),.1/Math.max(.001,input.slowRate)),.25,1);
}

export function standardSimulationAssumptions(objective:string,placementKey:string){
  const isArticle=placementKey.includes("article"),isVideo=placementKey.includes("video");
  return {rateJpyMicros:500_000_000,estimatedDailyOpportunities:isArticle?4_000:isVideo?7_500:10_000,
    expectedViewability:isArticle?.7:isVideo?.65:.6,expectedCtr:objective==="website_visits"?.012:.008,expectedConversionRate:objective==="website_visits"?.03:.01};
}
