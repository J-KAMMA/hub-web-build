'use client';
import {useEffect,useState} from 'react';
import {browserPostPeers} from '@/lib/hub-peer-browser';
import {peerReadText,type PeerState} from '@/lib/hub-peer-catalog.mjs';
import styles from './hub-network.module.css';

export function PeerConnectionDetails({state}:{state:PeerState}){
  return <div className={styles.peerDetails}>
    <p>{state.connected}台に接続{state.status==='waiting_account'?' · ログイン状態を確認しています':state.status==='reconnecting'?' · 再接続しています':state.status==='unavailable'?' · ログインと接続状態を確認してください':!state.enabled?' · 共有は停止中です':''}</p>
    {state.peers.length?<ul aria-label="同じHubプロフィールの端末">{state.peers.map(peer=><li key={peer.id}>
      <span>{peer.label} <small>· {peer.id.slice(0,6)}</small></span>
      <span>{peer.status==='connected'?'接続中':peer.status==='connecting'?'接続を試行中':'待機中'}</span>
    </li>)}</ul>:state.enabled?<p>別の端末で同じHubプロフィールにログインし、公開投稿の共有を許可すると表示されます。</p>:null}
    <p>取得元の表示は、追加したHubの公開投稿一覧が対象です。接続中でも、端末に投稿がない場合は配信元Hubから取得します。</p>
  </div>;
}

export function PublicPostPeerStatus(){
  const [state,setState]=useState<PeerState|null>(null);
  useEffect(()=>browserPostPeers(true)?.subscribe(setState),[]);
  if(!state)return null;
  return <details className={styles.peerStatus}>
    <summary>{peerReadText(state.lastRead)}</summary>
    <PeerConnectionDetails state={state}/>
    <a href="/v2/settings#public-post-peers">端末間共有の設定</a>
  </details>;
}
