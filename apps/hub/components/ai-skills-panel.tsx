"use client";

import { useEffect,useMemo,useState } from "react";
import { Download,FileJson,RotateCcw,ShieldCheck,Trash2,X } from "lucide-react";
import { OFFICIAL_SKILLS,SkillRegistry,assessSkillRisk,sha256Text,type HubSkillManifest } from "@/lib/ai-skill-registry";
import styles from "./ai-skills-panel.module.css";

const STORAGE_KEY="hub.ai.skills.v1";
type Stored={installed:HubSkillManifest[];history:Record<string,HubSkillManifest[]>};

export function AiSkillsPanel({onClose,onUse}:{onClose():void;onUse(skill:HubSkillManifest):void}){
  const [installed,setInstalled]=useState<HubSkillManifest[]>(OFFICIAL_SKILLS);
  const [history,setHistory]=useState<Record<string,HubSkillManifest[]>>({});
  const [notice,setNotice]=useState("");
  useEffect(()=>{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const value=JSON.parse(raw) as Stored;const registry=new SkillRegistry();for(const skill of [...OFFICIAL_SKILLS,...(value.installed??[])])registry.install(skill);setInstalled(registry.list());setHistory(value.history??{});}}catch{setNotice("保存済みスキルを読み込めませんでした。");}},[]);
  const risks=useMemo(()=>new Map(installed.map((skill)=>[skill.id,assessSkillRisk(skill)])),[installed]);
  function persist(next:HubSkillManifest[],nextHistory=history){setInstalled(next);setHistory(nextHistory);localStorage.setItem(STORAGE_KEY,JSON.stringify({installed:next,history:nextHistory} satisfies Stored));}
  async function importFiles(files:FileList|null){if(!files?.length)return;setNotice("");for(const file of [...files].slice(0,10)){if(file.size>2_000_000){setNotice(`${file.name}は2MBを超えています。`);continue;}try{const text=await file.text();let skill:HubSkillManifest;if(file.name.toLowerCase().endsWith(".json"))skill=JSON.parse(text) as HubSkillManifest;else{const hash=await sha256Text(text);skill={id:`local.${file.name.toLowerCase().replace(/[^a-z0-9._-]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"skill"}`,name:file.name.replace(/\.[^.]+$/,""),version:"1.0.0",author:"ローカルインポート",license:"要確認",source:{contentHash:hash},description:"ローカルから取り込んだ宣言型スキル",triggers:[],capabilities:["instructions"],tools:[],permissions:[],execution:{runtime:"instructions",network:"off",privacy:"local-only",compatibleHarnesses:["hub.local-runner"]},verification:[{kind:"response"}],instructions:text.slice(0,100_000)};}const registry=new SkillRegistry();for(const item of installed)registry.install(item);registry.install(skill);const nextHistory={...history,[skill.id]:[...(history[skill.id]??installed.filter((item)=>item.id===skill.id)),skill].slice(-10)};persist(registry.list(),nextHistory);setNotice(`${skill.name}を検証して登録しました。`);}catch(cause){setNotice(`インポートを拒否しました: ${cause instanceof Error?cause.message:"invalid_skill"}`);}}}
  function remove(skill:HubSkillManifest){if(OFFICIAL_SKILLS.some((item)=>item.id===skill.id)){setNotice("公式スキルは削除できません。");return;}persist(installed.filter((item)=>item.id!==skill.id));}
  function rollback(skill:HubSkillManifest){const versions=history[skill.id]??[],previous=versions.at(-2);if(!previous){setNotice("戻せるバージョンがありません。");return;}persist(installed.map((item)=>item.id===skill.id?previous:item),{...history,[skill.id]:versions.slice(0,-1)});setNotice(`${previous.version}へ戻しました。`);}
  return <section className={styles.overlay} aria-label="AIスキル管理"><div className={styles.panel}>
    <header><div><strong>スキル</strong><small>手順・ツール・権限・検証条件を管理します</small></div><button onClick={onClose} aria-label="閉じる"><X/></button></header>
    <label className={styles.import}><FileJson/><span><strong>OSSスキルをインポート</strong><small>JSONまたはMarkdown · 最大2MB · コードは実行しません</small></span><input type="file" multiple accept=".json,.md,.txt" onChange={(event)=>{void importFiles(event.target.files);event.currentTarget.value="";}}/><Download/></label>
    {notice?<p role="status">{notice}</p>:null}
    <div className={styles.list}>{installed.map((skill)=>{const risk=risks.get(skill.id)!;return <article key={skill.id}><div className={styles.title}><ShieldCheck/><span><strong>{skill.name}</strong><small>{skill.id} · v{skill.version} · {skill.license}</small></span><em data-risk={risk.level}>{risk.level==="low"?"低リスク":risk.level==="medium"?"要確認":"高リスク"}</em></div><p>{skill.description}</p><div className={styles.meta}><span>{skill.execution.runtime==="instructions"?"宣言型":"Docker実行型"}</span><span>{skill.execution.privacy==="local-only"?"ローカル限定":"ローカル優先"}</span><span>権限 {skill.permissions.length}</span><span>検証 {skill.verification.length}</span></div>{risk.reasons.length?<small>注意: {risk.reasons.join("・")}</small>:null}<div className={styles.actions}><button onClick={()=>onUse(skill)}>このスキルを使う</button><button onClick={()=>rollback(skill)} disabled={(history[skill.id]?.length??0)<2}><RotateCcw/>戻す</button><button onClick={()=>remove(skill)}><Trash2/>削除</button></div></article>})}</div>
  </div></section>;
}
