"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import type {SavedUserArticle} from "@/lib/server/d1-user-article-saves";
import {V2ArticleSave} from "./v2-article-save";
import {V2State} from "./v2-state";
import "../../app/v2/v2-article-list.css";
export function V2SavedArticles({authenticated,japanese=true}:{authenticated:boolean;japanese?:boolean}){
 const [articles,setArticles]=useState<SavedUserArticle[]>([]),[cursor,setCursor]=useState(""),[next,setNext]=useState<string|null>(null),[retry,setRetry]=useState(0),[status,setStatus]=useState("loading");
 useEffect(()=>{
  if(!authenticated)return;
  const controller=new AbortController();setStatus("loading");
  void fetch(`/api/articles/saved${cursor?`?after=${encodeURIComponent(cursor)}`:""}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
   const data=await response.json();
   if(!response.ok||!Array.isArray(data?.articles)||!data.articles.every((a:SavedUserArticle)=>a&&typeof a.id==="string"&&typeof a.title==="string"&&typeof a.summary==="string")||!(data.nextCursor===null||typeof data.nextCursor==="string"&&data.nextCursor>cursor))throw new Error();
   if(controller.signal.aborted)return;
   setArticles(old=>{const merged=new Map((cursor?old:[]).map(a=>[a.id,a]));for(const a of data.articles)merged.set(a.id,a);return [...merged.values()];});setNext(data.nextCursor);setStatus("ready");
  }).catch(()=>{if(!controller.signal.aborted)setStatus("failed");});
  return()=>controller.abort();
 },[authenticated,cursor,retry]);
 if(!authenticated)return <V2State kind="signedOut" next="/v2/articles/saved" japanese={japanese} title={japanese?"ログインして保存した記事を見る":"Sign in to view saved articles"}/>;
 return <section className="v2-alist" aria-label={japanese?"保存した記事":"Saved articles"}>
  {articles.length?<ul className="v2-agrid">{articles.map(article=><li key={article.id}>
   <Link className="v2-acard" href={`/v2/articles/${encodeURIComponent(article.id)}`}>
    <span className="v2-acard__art v2-acard__art--text">
     <span className="v2-acard__kicker"><span>{japanese?"記事":"Article"}</span></span>
     <strong className="v2-acard__title v2-acard__title--cover ui-title-wrap">{article.title}</strong>
    </span>
    {article.summary?<span className="v2-acard__summary">{article.summary}</span>:null}
   </Link>
   <div className="v2-saved-action"><V2ArticleSave articleId={article.id} authenticated japanese={japanese} initialSaved onRemoved={()=>setArticles(old=>old.filter(a=>a.id!==article.id))}/></div>
  </li>)}</ul>:null}
  {status==="loading"?<V2State kind="loading" compact rows={articles.length?2:4} japanese={japanese}/>:null}
  {status==="failed"?<V2State kind="error" compact japanese={japanese} title={japanese?"保存した記事を読み込めませんでした。":"Could not load saved articles."} action={{label:japanese?"もう一度読み込む":"Try again",onClick:()=>setRetry(v=>v+1)}}/>:null}
  {status==="ready"&&!articles.length?<V2State kind="empty" icon="bookmark" compact japanese={japanese} title={japanese?"保存した記事はありません":"No saved articles"} action={{label:japanese?"記事を探す":"Browse articles",href:"/v2/articles"}}/>:null}
  {status==="ready"&&next?<button className="v2-button v2-button--text" onClick={()=>setCursor(next)}>{japanese?"さらに読み込む":"Load more"}</button>:null}
 </section>;
}
