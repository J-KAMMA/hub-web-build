'use client';

import React,{useEffect,useId,useRef,useState} from 'react';
import QRCode from 'qrcode';
import {PeerTransfer,iceConfiguration,MAX_FILE_BYTES,type PeerState} from '@/lib/p2p-transfer.mjs';
import {AutoPair,createPairing,readPairing,pairingLink,PAIRING_RELAY_ORIGIN,type PairingTicket} from '@/lib/p2p-pairing.mjs';
import './p2p-transfer-panel.css';
import {P2PAccountDevices} from './p2p-account-devices';
import {normalizeHubOrigin} from '@/lib/hub-network-client';

export function P2PTransferPanel({pairOrigin,accountMode=false,sendFile,invitationUrl,onReceiveFile,maxFileBytes=MAX_FILE_BYTES,embedded=false,allowRelaySelection=false,purpose='files',createPeer}:{pairOrigin?:string;accountMode?:boolean;sendFile?:File;invitationUrl?:string;onReceiveFile?:(file:File)=>Promise<void>;maxFileBytes?:number;embedded?:boolean;allowRelaySelection?:boolean;purpose?:'files'|'ai';createPeer?:(configuration:RTCConfiguration,onChange:(state:PeerState)=>void)=>PeerTransfer}){
  const ai=purpose==='ai';
  const titleId=useId();
  const session=useRef<PeerTransfer|null>(null);
  const pairing=useRef<AutoPair|null>(null);
  const attempt=useRef(0);
  const [deviceGeneration,setDeviceGeneration]=useState(0);
  const [method,setMethod]=useState<'account'|'invite'>(accountMode?'account':'invite');
  const [state,setState]=useState<PeerState>({status:accountMode?'同じプロフィールの端末を選んで接続します。':'QRをスマホで読むだけで、接続を始められます。',code:'',ready:false,verified:false,remoteVerified:false});
  const [role,setRole]=useState<'host'|'guest'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [ticket,setTicket]=useState<PairingTicket|null>(null),[qr,setQr]=useState(''),[inviteLink,setInviteLink]=useState(''),[file,setFile]=useState<File|null>(null);
  const [stun,setStun]=useState('stun:stun.l.google.com:19302'),[turn,setTurn]=useState(''),[username,setUsername]=useState(''),[credential,setCredential]=useState(''),[relay,setRelay]=useState(false);
  const [download,setDownload]=useState('');
  const [pairingOrigin,setPairingOrigin]=useState(pairOrigin??'');
  const selectedFile=sendFile??file,limitValid=Number.isSafeInteger(maxFileBytes)&&maxFileBytes>0&&maxFileBytes<=MAX_FILE_BYTES;
  useEffect(()=>{if(!pairOrigin)setPairingOrigin(location.origin);},[pairOrigin]);
  useEffect(()=>{
    const invitation=()=>{if(!location.hash)return;const fragment=location.hash;reset();setMethod('invite');history.replaceState(null,'',location.pathname+location.search);try{const query=new URLSearchParams(location.search);if(query.getAll('pairRelay').length>1)throw Error('接続サービスの指定が重複しています。');if(query.has('pairRelay')){const value=query.get('pairRelay')!,origin=normalizeHubOrigin(value);if(value!==origin)throw Error('接続サービスのURLを確認してください。');if(!allowRelaySelection&&origin!==(pairOrigin||location.origin))throw Error('この画面では別の接続サービスを使えません。Hub本体で招待を開いてください。');setPairingOrigin(origin);}setTicket(readPairing(fragment));}catch(e){setError((e as Error).message);}};
    invitation();window.addEventListener('hashchange',invitation);window.addEventListener('hub-account-changed',reset);
    return()=>{window.removeEventListener('hashchange',invitation);window.removeEventListener('hub-account-changed',reset);attempt.current++;pairing.current?.close();session.current?.close();session.current=null;};
  },[]);
  useEffect(()=>{if(state.code){pairing.current?.close();setQr('');setInviteLink('');}},[state.code]);
  useEffect(()=>{if(!state.received){setDownload('');return;}const url=URL.createObjectURL(state.received.blob);setDownload(url);return()=>URL.revokeObjectURL(url);},[state.received]);
  async function run(action:()=>void|Promise<void>){const generation=attempt.current;setBusy(true);setError('');try{await action();}catch(e){if(generation===attempt.current)setError(e instanceof Error?e.message:'接続に失敗しました。');}finally{if(generation===attempt.current)setBusy(false);}}
  async function start(options:{invitation?:PairingTicket;account?:boolean;deliver?:(ticket:PairingTicket)=>Promise<void>}={}){
    if(!globalThis.RTCPeerConnection||!globalThis.crypto?.subtle)throw Error('WebRTCに対応したブラウザでHTTPSのページを開いてください。');
    const configuration=iceConfiguration(stun.trim(),turn.trim(),username,credential,relay);
    const origin=normalizeHubOrigin(pairingOrigin||location.origin),invitation=options.invitation||ticket||createPairing(),nextRole=options.invitation||ticket?'guest':'host';
    pairing.current?.close();session.current?.close();
    const onPeerChange=(next:PeerState)=>{if(session.current===peer)setState(next);};const peer=createPeer?createPeer(configuration,onPeerChange):new PeerTransfer(configuration,onPeerChange);session.current=peer;setRole(nextRole);
    const connection=new AutoPair(peer,invitation,origin,nextRole,message=>{if(session.current===peer){setError(message);setQr('');setInviteLink('');}});pairing.current=connection;
    try{
      await connection.connect();if(session.current!==peer)return;
      if(options.deliver){await options.deliver(invitation);if(session.current===peer)setState(previous=>({...previous,status:'相手の画面で接続を承認してください。'}));}
      else if(nextRole==='host'&&!options.account){
        const target=new URL(invitationUrl||(origin===PAIRING_RELAY_ORIGIN?pairingLink(origin,invitation):new URL('/p2p',location.origin).href));
        if(target.username||target.password||!(target.protocol==='https:'||(target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname))))throw Error('招待先はHTTPSのHubを選んでください。');
        if(invitationUrl||origin!==PAIRING_RELAY_ORIGIN)target.searchParams.set('pairRelay',origin);target.hash=new URL(pairingLink(origin,invitation)).hash;const link=target.href,image=embedded?'':await QRCode.toDataURL(link,{width:280,margin:4,errorCorrectionLevel:'M'});
        if(session.current!==peer)return;setInviteLink(link);setQr(image);setState(previous=>({...previous,status:embedded?'原本のHubで招待リンクを開き、接続を承認してください。':'スマホのカメラでQRを読み、開いた画面で「この端末に接続」を押してください。'}));
      }else setState(previous=>({...previous,status:'相手の端末につないでいます…'}));
    }catch(e){connection.close();peer.close('接続の準備をやり直してください。');if(session.current===peer){setRole(null);setQr('');setInviteLink('');}throw e;}
  }
  const reset=()=>{attempt.current++;setDeviceGeneration(n=>n+1);pairing.current?.close();session.current?.close();session.current=null;setBusy(false);setRole(null);setTicket(null);setQr('');setInviteLink('');setFile(null);setCredential('');setError('');setState({status:'新しい接続を開始できます。',code:'',ready:false,verified:false,remoteVerified:false});};
  return <section className="p2p-transfer" aria-labelledby={titleId}>
    <header>{embedded?<h2 id={titleId}>変更を端末間で渡す</h2>:<><p className="p2p-kicker">端末から端末へ</p><h1 id={titleId}>{ai?'自分のPCのAIにつなぐ':accountMode?'接続端末':ticket?'端末から招待が届きました':'スマホとファイルを送受信'}</h1></>}<p>{ai?'PCのHub Desktopで「設定 → AIの接続 → スマホから使う」を開き、招待リンクをこのスマホで開くか、ここで作った招待リンクをPCに貼り付けてください。つないだあとは、PCで「スマホから使える」をオンにした接続だけが使えます。キーやファイルの場所は送られません。':embedded?'接続相手を確認して、変更を直接送受信します。受信だけでは提案を保存しません。':method==='account'?'ログインした自分の端末を選んで、ファイルを送受信できます。':'QRでつないで、ファイルを選ぶ。アプリのインストールや接続コードの入力は不要です。'}</p></header>
    {accountMode&&<nav className="p2p-actions" aria-label="接続方法"><button type="button" disabled={!!role} aria-pressed={method==='account'} onClick={()=>{setTicket(null);setMethod('account');}}>自分の端末</button><button type="button" disabled={!!role} aria-pressed={method==='invite'} onClick={()=>setMethod('invite')}>招待リンク・QR</button></nav>}
    <p role="status" className="p2p-status">{state.status}</p>{error&&<p role="alert">{error}</p>}
    <p>接続サービス: {pairingOrigin||'このページと同じサービス'} · 利用する両方のHubが許可されたサービスを選んでください。テスト用サービスには接続元の制限があります。</p>
    {method==='account'&&<P2PAccountDevices key={deviceGeneration} busy={busy||!!role} onInvite={deliver=>run(()=>start({account:true,deliver}))} onAccept={invitation=>run(()=>start({account:true,invitation}))}/>}
    {method==='invite'&&!state.code&&<section><h2>{ticket?'招待した端末に接続':embedded?'原本のHubへ接続を招待':'スマホでQRを読む'}</h2>
      {!role&&<button type="button" className="p2p-primary" disabled={busy} onClick={()=>void run(start)}>{busy?'準備中…':ticket?'この端末に接続':embedded?'接続の招待を作る':'スマホとつなぐ'}</button>}
      {inviteLink&&<div className="p2p-invite">{!ai&&qr&&<img src={qr} width={280} height={280} alt="スマホのカメラで読み取る接続用QR"/>}<p>10分間有効 · この画面を開いたままにしてください</p><button type="button" data-invitation={inviteLink} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(inviteLink);})}>招待リンクをコピー</button>{embedded&&<a href={inviteLink} target="_blank" rel="noreferrer">原本のHubで受け取る</a>}</div>}
    </section>}
    <p className="p2p-note">{ai?'依頼と返答は端末間だけで送り、サーバーには保存しません。':'ファイルは端末間で送り、サーバーには保存しません。接続開始時にGoogleのSTUNを利用し、接続相手にIPアドレスが伝わる場合があります。'}</p>
      {!role&&<details><summary>回線・中継の設定</summary><p>既定のSTUNはGoogle提供です。直接つながらない場合は、利用可能なTURN中継を両端末に設定して作り直します。認証情報はこの画面のメモリだけに保持します。</p>
        <label>接続サービス URL<input value={pairingOrigin} disabled={!allowRelaySelection} onChange={e=>setPairingOrigin(e.target.value)} spellCheck={false}/></label>
        <label>STUN URL<input value={stun} onChange={e=>setStun(e.target.value)} spellCheck={false}/></label>
        <label>TURN URL<input value={turn} onChange={e=>setTurn(e.target.value)} placeholder="turns:relay.example:5349" spellCheck={false}/></label>
        <label>TURN 利用者名<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="off"/></label>
        <label>TURN 認証情報<input type="password" value={credential} onChange={e=>setCredential(e.target.value)} autoComplete="off"/></label>
        <label className="p2p-check"><input type="checkbox" checked={relay} onChange={e=>setRelay(e.target.checked)}/>中継のみ使う（相手に直接接続しない）</label>
      </details>}
    {state.code&&<section><h2>{state.ready?'接続済み':'両方の画面で番号を確認'}</h2><output className="p2p-code">{state.code}</output>{!state.ready&&<><p>同じ番号なら、両方の画面で確認を押してください。離れている相手とは通話などで照合します。</p><button type="button" disabled={state.verified} onClick={()=>void run(()=>session.current!.verify())}>{state.verified?'確認済み':'同じ番号であることを確認した'}</button></>}</section>}
    {ai&&state.ready&&<section><h2>PCとつながりました</h2><p>モデル選択に、PCで許可された接続が出ます。接続を終えると、実行中の依頼も止まります。</p></section>}
    {!ai&&state.ready&&<section><h2>{embedded?'変更を送受信する':'ファイルを選んで送る'}</h2><p>{maxFileBytes.toLocaleString()} バイトまで。ページを閉じると接続と未保存の受信データは失われます。</p>{sendFile?<p>送信する変更: {sendFile.name}</p>:<label>送信するファイル<input type="file" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>}<button type="button" disabled={!selectedFile||busy||!limitValid||selectedFile.size<1||selectedFile.size>maxFileBytes} onClick={()=>void run(()=>session.current!.offer(selectedFile!))}>{sendFile?'この変更を送信申請':'このファイルを送信申請'}</button>
      {state.pending&&<div className="p2p-receive"><strong>{state.pending.name}</strong><p>{state.pending.size.toLocaleString()} バイトを受信しますか？ 自動では保存・実行しません。</p>{(!limitValid||state.pending.size>maxFileBytes)&&<p role="alert">この画面の受信上限を超えています。</p>}<div className="p2p-actions"><button type="button" disabled={busy||!limitValid||state.pending.size>maxFileBytes} onClick={()=>void run(()=>session.current!.accept())}>受信する</button><button type="button" onClick={()=>session.current!.reject()}>断る</button></div></div>}
    </section>}
    {download&&state.received&&<a className="p2p-download" href={download} download={state.received.name}>受信ファイルを保存：{state.received.name}</a>}
    {state.received&&onReceiveFile&&<button type="button" disabled={busy||!limitValid||state.received.blob.size>maxFileBytes} onClick={()=>void run(()=>onReceiveFile(new File([state.received!.blob],state.received!.name,{type:'application/json'})))}>受信した変更を提案フォームへ</button>}
    {role&&<button type="button" className="p2p-end" onClick={reset}>接続を終了してやり直す</button>}
  </section>;
}
