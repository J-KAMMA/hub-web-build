'use client';
import {useEffect,useRef,useState} from 'react';
import {deviceKeys,sealDeviceInvitation,openDeviceInvitation,type DevicePublicKey} from '@/lib/p2p-device-crypto';
import type {PairingTicket} from '@/lib/p2p-pairing.mjs';

type Device={id:string;label:string;publicKey:DevicePublicKey};
type Invitation=Device&{fromDevice:string;ciphertext:string};
type Props={busy:boolean;onInvite:(deliver:(ticket:PairingTicket)=>Promise<void>)=>Promise<void>;onAccept:(ticket:PairingTicket)=>Promise<void>};
class DeviceApiError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function api(body?:Record<string,unknown>,deviceId?:string){
  const response=await fetch(`/api/p2p/devices${deviceId?`?deviceId=${encodeURIComponent(deviceId)}`:''}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok)throw new DeviceApiError(data.error||'端末を確認できません。',response.status);return data;
}
export function P2PAccountDevices({busy,onInvite,onAccept}:Props){
  const current=useRef<{id:string;privateKey:CryptoKey}|null>(null);
  const [generation,setGeneration]=useState(0),[devices,setDevices]=useState<Device[]>([]),[invitations,setInvitations]=useState<Invitation[]>([]);
  const [status,setStatus]=useState('端末を準備しています…'),[error,setError]=useState(''),[login,setLogin]=useState(false),[pending,setPending]=useState(false),[ownId,setOwnId]=useState('');
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>,deviceId='';setError('');setLogin(false);setOwnId('');setDevices([]);setInvitations([]);
    const remove=(id:string)=>{void fetch('/api/p2p/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',deviceId:id}),credentials:'same-origin',keepalive:true}).catch(()=>{});};
    const refresh=async()=>{
      try{
        await api({action:'heartbeat',deviceId});const data=await api(undefined,deviceId);if(stopped)return;
        setDevices(data.devices);setInvitations(data.invitations);setStatus('この画面を開いている間、接続を受け付けています。');timer=setTimeout(()=>void refresh(),10000);
      }catch(e){if(stopped)return;current.current=null;setDevices([]);setInvitations([]);setError(e instanceof Error?e.message:'端末を確認できません。');setLogin(e instanceof DeviceApiError&&e.status===401);}
    };
    void (async()=>{
      try{
        const keys=await deviceKeys();if(stopped)return;
        const label=/Android/i.test(navigator.userAgent)?'Androidスマホ':/iPhone|iPad/i.test(navigator.userAgent)?'iPhone・iPad':/Windows/i.test(navigator.userAgent)?'Windows PC':/Macintosh/i.test(navigator.userAgent)?'Mac':'ブラウザ';
        const registered=await api({action:'register',label,publicKey:keys.publicKey});deviceId=registered.id;
        if(stopped){remove(deviceId);return;}current.current={id:deviceId,privateKey:keys.privateKey};setOwnId(deviceId);await refresh();
      }catch(e){if(stopped)return;setError(e instanceof Error?e.message:'端末を確認できません。');setLogin(e instanceof DeviceApiError&&e.status===401);}
    })();
    return()=>{stopped=true;clearTimeout(timer);current.current=null;if(deviceId)remove(deviceId);};
  },[generation]);
  async function action(task:()=>Promise<void>){setPending(true);setError('');try{await task();}catch(e){setError(e instanceof Error?e.message:'接続を確認できません。');}finally{setPending(false);}}
  async function invite(device:Device){
    const own=current.current;if(!own)return;
    await onInvite(async ticket=>{const id=crypto.randomUUID(),ciphertext=await sealDeviceInvitation(own.privateKey,device.publicKey,id,own.id,device.id,ticket);await api({action:'invite',deviceId:own.id,toDevice:device.id,id,ciphertext});setStatus(`${device.label} の接続承認を待っています。`);});
  }
  async function respond(invitation:Invitation,accept:boolean){
    const own=current.current;if(!own)return;
    const ticket=accept?await openDeviceInvitation(own.privateKey,invitation.publicKey,invitation.id,invitation.fromDevice,own.id,invitation.ciphertext):null;
    await api({action:accept?'accept':'decline',deviceId:own.id,id:invitation.id});setInvitations(list=>list.filter(i=>i.id!==invitation.id));if(ticket)await onAccept(ticket);
  }
  return <section aria-labelledby="p2p-devices-title"><h2 id="p2p-devices-title">自分の端末</h2><p>同じHubプロフィールでログインし、両方でこの画面を開いてください。端末を選んで、相手の画面で接続を承認します。</p>
    {error?<div role="alert"><p>{error}</p>{login?<a href="/v2/auth?next=%2Fp2p">Hubにログイン</a>:<button disabled={busy||pending} onClick={()=>setGeneration(n=>n+1)}>待ち受けを再開</button>}</div>:<p role="status">{status}</p>}
    {!error&&ownId&&devices.filter(d=>d.id!==ownId).length===0&&<p>ほかの端末を待っています。スマホでもHubの「接続端末」を開いてください。</p>}
    <ul className="p2p-device-list">{devices.filter(d=>d.id!==ownId).map(device=><li key={device.id}><span>{device.label}</span><button disabled={busy||pending||!current.current} onClick={()=>void action(()=>invite(device))}>この端末につなぐ</button></li>)}</ul>
    {invitations.map(invitation=><div className="p2p-receive" key={invitation.id}><strong>{invitation.label} から接続の確認</strong><p>接続後も、ファイルの受信には別の承認が必要です。</p><div className="p2p-actions"><button disabled={busy||pending} onClick={()=>void action(()=>respond(invitation,true))}>接続を承認</button><button disabled={pending} onClick={()=>void action(()=>respond(invitation,false))}>断る</button></div></div>)}
  </section>;
}
