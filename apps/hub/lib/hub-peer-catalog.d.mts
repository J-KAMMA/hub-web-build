export type PeerRead={origin:string;via:'peer'|'publisher';peerLabel?:string};
export type PeerState={enabled:boolean;connected:number;status:string;viaPeer:number;peers:Array<{id:string;label:string;status:'connected'|'connecting'|'available'}>;lastRead:PeerRead|null};
export function peerReadText(read:PeerRead|null):string;
export type PostCatalog={protocol:string;kind:string;items:Array<{id:string;title:string;summary:string;path:string;updatedAt:string}>};
export type PostManifest={protocol:string;origin:string;digest:string;bytes:number;expiresAt:number};
export function peerOrigin(raw:unknown):string;
export function publicPostText(value:unknown):string;
export function catalogDigest(origin:string,text:string):Promise<string>;
export function postManifest(origin:string,catalog:unknown):Promise<PostManifest>;
export function checkManifest(value:unknown,origin:string):PostManifest;
export function verifyPostText(text:string,origin:string,manifest:unknown):Promise<PostCatalog>;
export function sealPeerSignal(privateKey:CryptoKey,publicKey:JsonWebKey,id:string,from:string,to:string,value:unknown):Promise<string>;
export function openPeerSignal(privateKey:CryptoKey,publicKey:JsonWebKey,id:string,from:string,to:string,ciphertext:string):Promise<{type:'offer'|'answer';connectionId:string;sdp:string}>;
export function createPeerCatalog(options:{base:string;storage:Pick<Storage,'getItem'|'setItem'>;control:(input:Record<string,unknown>)=>Promise<any>;readCatalog:(origin:string,signal?:AbortSignal)=>Promise<unknown>;readManifest:(origin:string,signal?:AbortSignal)=>Promise<unknown>;label?:string;onState?:(state:PeerState)=>void;iceServers?:RTCIceServer[]}):{
  read(origin:string,signal?:AbortSignal):Promise<PostCatalog>;refresh():Promise<void>;syncConsent():Promise<void>;setEnabled(enabled:boolean):Promise<void>;subscribe(fn:(state:PeerState)=>void):()=>void;dispose():Promise<void>;readonly state:PeerState;
};
