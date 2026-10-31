"use client";
import { useState } from "react";
import { Board } from "@/lib/domain";
type BoardGroup = { key:string; name:string; description?:string; boards:Board[] };
export function BbsBoardGroups({ groups }: { groups: BoardGroup[] }) {
  const [openGroups,setOpenGroups]=useState<Record<string,boolean>>(Object.fromEntries(groups.map((group,index)=>[group.key,index===0||group.boards.some((board)=>board.threadCount>0)])));
  return <div className="bbs-board-groups">{groups.map((group)=>{const open=openGroups[group.key]??false;return <section key={group.key} className="bbs-board-group">
    <button type="button" className="bbs-board-group__toggle" onClick={()=>setOpenGroups((c)=>({...c,[group.key]:!open}))} aria-expanded={open}>
      <span><span className="bbs-board-group__title">{group.name}</span>{group.description&&<small className="bbs-board-group__description">{group.description}</small>}</span>
      <span className="bbs-board-group__meta">{group.boards.reduce((total,board)=>total+board.threadCount,0)} スレッド ・ {group.boards.length} テーマ</span><span className="bbs-board-group__chevron">{open?"−":"＋"}</span>
    </button>
    {open&&<div className="bbs-board-list">{group.boards.map((board)=><a key={board.id} href={`/bbs/${board.key}`} className="bbs-board-row"><span className="bbs-board-row__name">{board.title}</span><span className="bbs-board-row__desc">{board.description}</span><span className="bbs-board-row__count">{board.threadCount} 件</span><span aria-hidden="true">›</span></a>)}</div>}
  </section>})}</div>;
}
