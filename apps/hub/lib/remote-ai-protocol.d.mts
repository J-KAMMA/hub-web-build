export const LABEL:string;export const FRAME_MAX:number;export const CHUNK_CHARS:number;
export const LIMITS:Readonly<{messages:number;messageChars:number;totalChars:number;outputChars:number;models:number;sources:number}>;
export type RemoteSource={source:'api'|'cli';id:string;name:string;models:string[];defaultModel:string|null};
export type RemoteMessage={role:'user'|'assistant';content:string};
export function chunkText(text:string,size?:number):string[];
export function parseFrame(data:unknown):{type:string;[key:string]:unknown};
export function frame(message:object):string;
export function safeCode(code:unknown):string;
export function readSource(value:unknown):RemoteSource;
export function runFrames(id:string,target:{source:'api'|'cli';sourceId:string;model?:string|null},messages:RemoteMessage[]):string[];
export class RunAssembler{constructor(header:object);header:{id:string};push(message:object):void;finish():{source:string;id:string;model:string|null;messages:RemoteMessage[]}}
