export const MAX_FILE_BYTES: number;
export type PeerState = {status:string;code:string;ready:boolean;verified:boolean;remoteVerified:boolean;pending?:{name:string;size:number};received?:{name:string;blob:Blob}};
export function iceConfiguration(stun?:string,turn?:string,username?:string,credential?:string,relay?:boolean):RTCConfiguration;
export function readSignal(code:string,type:'offer'|'answer',now?:number):{v:number;id:string;expires:number;type:'offer'|'answer';sdp:string};
export class PeerTransfer {
 constructor(configuration:RTCConfiguration,onChange:(state:PeerState)=>void,options?:{label?:string});
 label:string;closed:boolean;channel?:RTCDataChannel;state:PeerState;
 update(patch:Partial<PeerState>):void;guard():void;receive(data:unknown):Promise<void>;
 invite():Promise<string>;join(code:string):Promise<string>;answer(code:string):Promise<void>;
 verify():void;offer(file:File):Promise<void>;accept():void;reject():void;close(status?:string):void;
}
