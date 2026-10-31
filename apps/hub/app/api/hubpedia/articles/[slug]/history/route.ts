import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { listHistory,listPublicAudit } from "@/lib/server/hubpedia-wiki";
export async function GET(_:Request,{params}:{params:Promise<{slug:string}>}){const {slug}=await params,db=getHubD1();const[revisions,audits]=await Promise.all([listHistory(db,slug),listPublicAudit(db,slug)]);return NextResponse.json({revisions,audits});}
