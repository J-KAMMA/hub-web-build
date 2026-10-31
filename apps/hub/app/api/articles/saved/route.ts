import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {HubAuthenticationError,requireHubSessionProfile} from "@/lib/server/hub-session";
import {listSavedUserArticles} from "@/lib/server/d1-user-article-saves";
export async function GET(request:Request){
 const headers={"Cache-Control":"no-store"};
 try{
  const db=getHubD1(),viewer=await requireHubSessionProfile(request,db);
  const after=new URL(request.url).searchParams.get("after")??"";
  if(after.length>200)return NextResponse.json({error:"Invalid cursor."},{status:400,headers});
  return NextResponse.json(await listSavedUserArticles(db,viewer.id,after),{headers});
 }catch(error){
  return NextResponse.json({error:error instanceof HubAuthenticationError?"ログインが必要です。":"保存した記事を読み込めませんでした。"},{status:error instanceof HubAuthenticationError?401:503,headers});
 }
}
