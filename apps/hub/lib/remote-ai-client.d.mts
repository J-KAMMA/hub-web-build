import {PeerTransfer,type PeerState} from './p2p-transfer.mjs';
import type {RemoteSource,RemoteMessage} from './remote-ai-protocol.mjs';
export const ERROR_TEXT:Readonly<Record<string,string>>;
export function errorText(code:unknown):string;
export type RemoteEvent={type:'listing'}|{type:'sources';sources:RemoteSource[]}|{type:'error';code:string}|{type:'closed'};
export type RunHandlers={delta(text:string):void;end(result:{cancelled:boolean}):void;error(code:string):void};
export class RemoteAiClientPeer extends PeerTransfer{
 constructor(configuration:RTCConfiguration,onChange:(state:PeerState)=>void,onRemote?:(event:RemoteEvent)=>void);
 sources:RemoteSource[];
 refresh():void;
 start(target:{source:'api'|'cli';sourceId:string;model?:string|null},messages:RemoteMessage[],handlers:RunHandlers):string;
 cancel():void;
}
