"use client";
import {useEffect,useRef,useState} from "react";
import type {ThreadSummary} from "./domain";
export function useThreadCandidates(initial:ThreadSummary[], initialExcerpts:Record<string,string>, queryString:string|undefined) {
  const enabled=queryString!==undefined;
  const [threads,setThreads]=useState(initial);
  const [excerpts,setExcerpts]=useState(initialExcerpts);
  const [loading,setLoading]=useState(enabled);
  const [error,setError]=useState(false);
  const [hasMore,setHasMore]=useState(enabled);
  const [batch,setBatch]=useState(0);
  const cursor=useRef<string|null>(null),complete=useRef(false);
  useEffect(()=>{
    if(!enabled||complete.current)return;
    const controller=new AbortController();setLoading(true);setError(false);
    void(async()=>{
      try{
        for(let page=0;page<20;page++){
          const before=cursor.current,params=new URLSearchParams(queryString);
          if(before)params.set("after",before);
          const response=await fetch(`/api/thread-discovery${params.size?`?${params}`:""}`,{signal:controller.signal,cache:"no-store"});
          if(!response.ok)throw new Error("Threads unavailable");
          const body=await response.json();if(controller.signal.aborted)return;
          if(!Array.isArray(body.threads)||body.threads.some((t:ThreadSummary)=>!t||typeof t.id!=="string"||typeof t.title!=="string"||typeof t.boardKey!=="string"||typeof t.updatedAt!=="string"||!Number.isFinite(t.postCount)||!Array.isArray(t.tags)||t.tags.some(tag=>typeof tag!=="string"))||!body.excerpts||typeof body.excerpts!=="object"||Array.isArray(body.excerpts)||Object.values(body.excerpts).some(v=>typeof v!=="string"))throw new Error("Invalid thread candidates");
          const next=body.nextCursor;
          if(next!==null&&(typeof next!=="string"||!next||next.length>200||(before!==null&&next<=before)))throw new Error("Invalid cursor");
          setThreads(previous=>[...new Map([...(before?previous:[]),...body.threads].map((t:ThreadSummary)=>[t.id,t])).values()]);
          setExcerpts(previous=>({...(before?previous:{}),...body.excerpts}));
          cursor.current=next;setHasMore(next!==null);
          if(next===null){complete.current=true;break;}
        }
      }catch{if(!controller.signal.aborted)setError(true);}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();return()=>controller.abort();
  },[enabled,queryString,batch]);
  return {threads:enabled?threads:initial,excerpts:enabled?excerpts:initialExcerpts,loading:enabled&&loading,error:enabled&&error,hasMore:enabled&&hasMore,continueLoading:()=>setBatch(n=>n+1)};
}
