import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {hasSameOrigin} from "@/lib/server/hub-auth-route";
import {HubAuthenticationError,requireHubSessionProfile} from "@/lib/server/hub-session";
import {findUserArticle} from "@/lib/server/d1-user-articles";
import {isUserArticleSaved,saveUserArticle,unsaveUserArticle} from "@/lib/server/d1-user-article-saves";
const headers={"Cache-Control":"no-store"};
type Context={params:Promise<{articleId:string}>};
async function handle(request:Request,{params}:Context,action:"read"|"save"|"remove"){
 if(action!=="read"&&!hasSameOrigin(request))return NextResponse.json({error:"Invalid request origin."},{status:403,headers});
 try{
  const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{articleId}=await params;
  if(!articleId||articleId.length>200)return NextResponse.json({error:"Invalid article."},{status:400,headers});
  if(action==="remove"){
   await unsaveUserArticle(db,viewer.id,articleId);
   return NextResponse.json({saved:false},{headers});
  }
  if(action==="save"){
   if(!await saveUserArticle(db,viewer.id,articleId))return NextResponse.json({error:"記事が見つかりません。"},{status:404,headers});
   return NextResponse.json({saved:true},{headers});
  }
  if(!await findUserArticle(db,articleId,{audience:"general"}))return NextResponse.json({error:"記事が見つかりません。"},{status:404,headers});
  return NextResponse.json({saved:await isUserArticleSaved(db,viewer.id,articleId)},{headers});
 }catch(error){
  return NextResponse.json({error:error instanceof HubAuthenticationError?"ログインが必要です。":"保存状態を確認・更新できませんでした。"},{status:error instanceof HubAuthenticationError?401:503,headers});
 }
}
export const GET=(request:Request,context:Context)=>handle(request,context,"read");
export const POST=(request:Request,context:Context)=>handle(request,context,"save");
export const DELETE=(request:Request,context:Context)=>handle(request,context,"remove");
