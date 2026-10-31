import {NextResponse} from "next/server";
import {requireSameOrigin} from "@/lib/server/moderation-admin-auth";
import {advertiserSessionFromRequest} from "@/lib/server/hub-ads-advertiser-session";
import {simulateHubAdDelivery,standardSimulationAssumptions} from "@/lib/hub-ads-advanced-optimization";
import {recommendHubAdPricing} from "@/lib/hub-ad-pricing";
export async function POST(request:Request){const origin=requireSameOrigin(request);if(origin)return origin;if(!advertiserSessionFromRequest(request))return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;if(!body)return NextResponse.json({error:"invalid_simulation"},{status:400});
  const numbers=["budgetJpyMicros","days"] as const;
  if(numbers.some((key)=>!Number.isFinite(Number(body[key]))))return NextResponse.json({error:"invalid_simulation"},{status:400});
  const objective=String(body.objective??"awareness"),placementKey=String(body.placementKey??"");if(!["awareness","website_visits","sponsorship"].includes(objective)||!/^[a-z0-9]+(?:[._-][a-z0-9]+){1,7}$/.test(placementKey))return NextResponse.json({error:"invalid_simulation"},{status:400});
  const assumptions=standardSimulationAssumptions(objective,placementKey);
  const budgetJpyMicros=Number(body.budgetJpyMicros),days=Number(body.days);
  const recommendation=recommendHubAdPricing({objective,placementKey,totalBudgetJpyMicros:budgetJpyMicros,days});
  return NextResponse.json({...simulateHubAdDelivery({budgetJpyMicros,days,pacingMode:"even",...assumptions}),assumptions,recommendation},{headers:{"Cache-Control":"no-store"}});
}
