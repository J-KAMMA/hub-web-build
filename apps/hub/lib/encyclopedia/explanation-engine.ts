export type ExplanationRole="overview"|"background"|"mechanism"|"example"|"relations"|"uncertainty"|"sources"|"detail";
export type ExplanationBlock={key:string;role:ExplanationRole;heading:string;bodyMarkdown:string;position:number};

const rolePatterns:Array<[ExplanationRole,RegExp]>= [
 ["overview",/概要|とは|overview|definition/iu],["background",/背景|歴史|前提|background|history/iu],
 ["mechanism",/仕組み|機構|過程|原因|mechanism|process|cause/iu],["example",/具体例|事例|例|example|case/iu],
 ["relations",/関連|関係|related|relationship/iu],["uncertainty",/論争|不確実|未解決|限界|controvers|uncertain|open question|limit/iu],
 ["sources",/出典|参考文献|source|reference/iu]
];
const slugKey=(value:string,index:number)=>{const normalized=value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/gu,"").slice(0,64);return normalized||`block-${index+1}`;};
export function explanationRoleForHeading(heading:string):ExplanationRole{return rolePatterns.find(([,pattern])=>pattern.test(heading))?.[0]??"detail";}
export function parseExplanationBlocks(markdown:string):ExplanationBlock[]{
 const matches=[...markdown.matchAll(/^##\s+(.+)$/gmu)];
 if(!matches.length)return [{key:"overview",role:"overview",heading:"概要",bodyMarkdown:markdown.trim(),position:0}];
 const blocks:ExplanationBlock[]=[];
 const preface=markdown.slice(0,matches[0].index).trim();if(preface)blocks.push({key:"introduction",role:"overview",heading:"概要",bodyMarkdown:preface,position:0});
 for(const [index,match] of matches.entries()){const heading=match[1].trim(),start=(match.index??0)+match[0].length,end=matches[index+1]?.index??markdown.length;blocks.push({key:slugKey(heading,index),role:explanationRoleForHeading(heading),heading,bodyMarkdown:markdown.slice(start,end).trim(),position:blocks.length});}
 return blocks;
}
export function renderExplanationBlocks(blocks:ExplanationBlock[]){return blocks.sort((a,b)=>a.position-b.position).map(block=>`## ${block.heading}\n\n${block.bodyMarkdown}`).join("\n\n").trim();}
