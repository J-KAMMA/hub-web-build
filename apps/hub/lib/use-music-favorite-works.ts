"use client";
import {useEffect,useState} from "react";
import {MUSIC_WORKS,type MusicWork} from "./music-catalog";
export function useMusicFavoriteWorks(ids:string[],enabled:boolean){
 const key=JSON.stringify([...new Set(ids)].sort());
 const [result,setResult]=useState<{key:string;works:MusicWork[];status:"loading"|"ready"|"failed"}>({key:"",works:[],status:"loading"});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController(),wanted:string[]=JSON.parse(key),staticWorks=new Map(MUSIC_WORKS.map(work=>[work.id,work]));
  const all=wanted.flatMap(id=>staticWorks.has(id)?[staticWorks.get(id)!]:[]),remote=wanted.filter(id=>!staticWorks.has(id));
  setResult({key,works:all,status:remote.length?"loading":"ready"});
  void(async()=>{
   for(let offset=0;offset<remote.length;offset+=60){
    const chunk=remote.slice(offset,offset+60),query=new URLSearchParams({ids:chunk.join(',')});
    const response=await fetch(`/api/music/library-catalog?${query}`,{cache:"no-store",signal:controller.signal});const data=await response.json();
    if(!response.ok||!Array.isArray(data?.works)||!data.works.every((work:MusicWork)=>work&&chunk.includes(work.id)&&typeof work.title==="string"&&Array.isArray(work.services)))throw new Error();
    all.push(...data.works);
   }
   if(!controller.signal.aborted)setResult({key,works:all,status:"ready"});
  })().catch(()=>{if(!controller.signal.aborted)setResult({key,works:all,status:"failed"});});
  return()=>controller.abort();
 },[key,enabled,retry]);
 return {works:result.key===key?result.works:[],status:result.key===key?result.status:"loading",retry:()=>setRetry(value=>value+1)};
}
