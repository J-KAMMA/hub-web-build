import {NextResponse} from "next/server";import {JOB_TEMPLATES} from "@/lib/jobs";export async function GET(){return NextResponse.json({templates:JOB_TEMPLATES});}
