import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hashHubAdConversionKey, recordHubAdConversion, verifyHubAdAttributionToken } from "@/lib/server/hub-ads-conversion";

export async function POST(request:Request){
  const text=await request.text();if(text.length>4096)return NextResponse.json({error:"request_too_large"},{status:413});
  type ConversionBody={attribution?:unknown;type?:unknown;valueJpyMicros?:unknown};
  let parsed:unknown;try{parsed=JSON.parse(text||"null");}catch{return NextResponse.json({error:"invalid_json"},{status:400});}
  const body:ConversionBody|null=parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as ConversionBody:null;
  const bearer=request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const attribution=typeof body?.attribution==="string"?verifyHubAdAttributionToken(body.attribution):null;
  const value=body?.valueJpyMicros===undefined?null:Number(body.valueJpyMicros);
  if(!bearer||!attribution||typeof body?.type!=="string")return NextResponse.json({error:"invalid_conversion"},{status:400});
  const recorded=await recordHubAdConversion(getHubD1(),attribution,body.type,value,hashHubAdConversionKey(bearer));
  return recorded?NextResponse.json({recorded:true},{status:201,headers:{"Cache-Control":"no-store"}})
    :NextResponse.json({error:"conversion_rejected"},{status:409,headers:{"Cache-Control":"no-store"}});
}
