import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import {V2Shell} from "@/components/v2/v2-shell";
import {V2ColumnHead} from "@/components/v2/v2-columns";
import {V2Aside} from "@/components/v2/v2-aside";
import {V2MediaColumn} from "@/components/v2/v2-media-column";
import {V2SavedArticles} from "@/components/v2/v2-saved-articles";
import {getAppShellData} from "@/lib/server/app-shell-data";
import {getHubLocale} from "@/lib/server/locale";
import {loadV2MediaColumn} from "@/lib/server/v2-media-column";
import {v2NavItems} from "@/lib/v2-nav";
import "../../v2.css";
import "../../redesign-media.css";
import "../../v2-article-list.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";
export const dynamic="force-dynamic";
export const metadata={title:"保存した記事 | Hub"};
export default async function SavedArticlesPage(){
 const [shell,locale]=await Promise.all([getAppShellData(),getHubLocale()]);const japanese=locale==="ja";
 const viewerId=shell.currentProfile.id||null;
 const column=await loadV2MediaColumn(viewerId,"articles");
 const library=await loadViewerLibrary(viewerId,"articles",japanese);
 const directory=<><V2MediaColumn kind="articles" japanese={japanese} topRows={[
  {key:"home",label:japanese?"ホーム":"Home",icon:"home",href:"/v2/articles"},
  ...(viewerId?[
   {key:"saved",label:japanese?"保存した記事":"Saved articles",icon:"bookmark" as const,href:"/v2/articles/saved",selected:true},
   {key:"drafts",label:japanese?"下書き":"Drafts",icon:"edit" as const,href:"/v2/articles/drafts"},
  ]:[]),
 ]} initial={column.initial}/><V2LibraryColumn data={library} signedIn={Boolean(viewerId)} japanese={japanese} next="/v2/articles/saved"/></>;
 return <V2Shell skin="luxe" currentPath="/v2/articles" profile={shell.currentProfile} items={v2NavItems(japanese,{notifications:shell.unreadIndicatorCount,messages:shell.unreadMessageCount})} directory={viewerId?directory:undefined} aside={<V2Aside title={japanese?"並べて見る":"Alongside"} posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={shell.currentProfile.id}/>} japanese={japanese}>
  <V2ColumnHead heading title={japanese?"保存した記事":"Saved articles"}/>
  <V2SavedArticles key={viewerId??"guest"} authenticated={Boolean(viewerId)} japanese={japanese}/>
 </V2Shell>;
}
