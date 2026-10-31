'use client';
import {useEffect,useState} from 'react';
import {browserPostPeers} from '@/lib/hub-peer-browser';
import {peerReadText,type PeerState} from '@/lib/hub-peer-catalog.mjs';
import {PeerConnectionDetails} from './public-post-peer-status';
import styles from './hub-network.module.css';
export function PublicPostPeerSettings(){
  const [state,setState]=useState<PeerState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const peer=browserPostPeers(true);return peer?.subscribe(setState);},[]);
  async function toggle(){const peer=browserPostPeers(true);if(!peer)return;setBusy(true);setError('');try{await peer.setEnabled(!state?.enabled);}catch(e){setError(e instanceof Error?e.message:'設定を保存できません。');}finally{setBusy(false);}}
  return <section className={styles.settings} id="public-post-peers" aria-labelledby="public-post-peers-title">
    <h3 id="public-post-peers-title">自分の端末から公開投稿を取得</h3>
    <p>同じHubプロフィールで許可した端末同士を自動でつなぎます。接続先Hubで閲覧した公開投稿だけを、Hubを開いている間に共有します。接続できない場合は配信元Hubから取得します。</p>
    <p className={styles.status}>接続相手と接続補助サービスにIPアドレスが伝わります。DM・非公開投稿・端末内ファイルは共有しません。ここからいつでも停止できます。</p>
    <button type="button" disabled={busy||!state} onClick={()=>void toggle()}>{state?.enabled?'この端末の共有を停止':'この端末の公開投稿共有を許可'}</button>
    {state?.status==='unavailable'&&<button type="button" disabled={busy} onClick={()=>void browserPostPeers(true)?.refresh()}>接続を再確認</button>}
    <p role="status">{error||(!state?'このブラウザでは端末間接続を準備できません。':state.status==='waiting_account'?'この端末のログイン状態を確認しています…':state.status==='reconnecting'?'接続が戻り次第、自動で再接続します。投稿は配信元Hubから取得します。':state.status==='unavailable'?'ログインと接続状態を確認してください。投稿は配信元Hubから取得します。':state.enabled?`${state.connected}台に接続 · 端末からの取得 ${state.viaPeer}回`:'端末間共有は停止中です。')}</p>
    {state?<><p className={styles.status}>{peerReadText(state.lastRead)}</p><details className={styles.peerStatus}><summary>端末の接続状況</summary><PeerConnectionDetails state={state}/></details></>:null}
  </section>;
}
