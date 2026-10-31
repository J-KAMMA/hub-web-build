import type {PeerTransfer} from './p2p-transfer.mjs';
export const PAIRING_RELAY_ORIGIN:string;
export type PairingTicket={room:string;key:string;expires:number};
export type PairingTransportRequest={origin:string;room:string;role:'host'|'guest';expires:number;method:'GET'|'POST';action:''|'start'|'signal';body?:ArrayBuffer;signal:AbortSignal};
export type PairingTransportResponse={status:number;data:ArrayBuffer|null};
export type PairingTransport=(request:PairingTransportRequest)=>Promise<PairingTransportResponse>;
export function createPairing():PairingTicket;
export function readPairing(fragment:string,now?:number):PairingTicket;
export function pairingLink(origin:string,ticket:PairingTicket):string;
export function sealSignal(ticket:PairingTicket,type:'offer'|'answer',text:string):Promise<ArrayBuffer>;
export function openSignal(ticket:PairingTicket,type:'offer'|'answer',frame:ArrayBuffer):Promise<string>;
export class AutoPair {
 constructor(peer:PeerTransfer,ticket:PairingTicket,origin:string,role:'host'|'guest',onError:(message:string)=>void,transport?:PairingTransport);
 connect():Promise<void>;close():void;
}
