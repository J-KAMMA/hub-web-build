// スマホ（Hub Web）側: 自分のPCのAI接続を、ペアリング済みのWebRTCチャネル "hub-ai-v1" 越しに使う。
// Hubサーバーを通るのは暗号化された接続情報だけ。依頼と返答は端末間で送り、サーバーへは保存しない。
// PC側の約束（許可した接続だけ・上限・CLIは読み取り専用）は apps/hub-desktop が決める。ここは頼んで受け取るだけ。
import {PeerTransfer} from './p2p-transfer.mjs';
import {LABEL,LIMITS,FRAME_MAX,frame,parseFrame,readSource,runFrames,safeCode} from './remote-ai-protocol.mjs';

export const ERROR_TEXT=Object.freeze({
  byok_remote_off:'PC側でスマホ接続が有効になっていません。PCの「スマホから使う」で接続し直してください。',
  byok_remote_not_allowed:'この接続はPCで「スマホから使える」がオンになっていません。PCの設定で許可してください。',
  byok_remote_rate:'スマホからの依頼が多すぎます。しばらく待ってからもう一度お試しください。',
  byok_remote_too_large:'依頼が長すぎます。短くしてもう一度お試しください。',
  byok_busy:'PCで別の依頼を実行中です。終わってからお試しください。',
  byok_auth_failed:'PC側のAPIキーが無効です。PCの「AIの接続」を確認してください。',
  byok_rate_limited:'AI事業者の利用制限に達しました。しばらくしてからお試しください。',
  byok_quota_exceeded:'AI事業者側の利用枠または残高が足りません。',
  byok_model_not_found:'このモデルは使えません。選び直してください。',
  byok_cli_not_logged_in:'PCのCLIがログインしていません。PCのターミナルでログインしてください。',
  byok_cli_not_installed:'PCにこのCLIが見つかりません。',
  byok_timeout:'PCの処理が時間内に終わりませんでした。',
  byok_response_too_large:'返答が大きすぎるため止めました。',
  byok_disabled:'この接続はPCで無効になっています。',
  byok_unreachable:'PCからAI事業者に届きませんでした。',
});
export const errorText=code=>ERROR_TEXT[safeCode(code)]??'PCでの実行に失敗しました。PC側の画面を確認してください。';

/** 1つのPCとの間の、1本のAI用チャネル。 */
export class RemoteAiClientPeer extends PeerTransfer{
  constructor(configuration,onChange,onRemote=()=>{}){
    super(configuration,onChange,{label:LABEL});
    this.onRemote=onRemote;this.sources=[];this.expected=0;this.listing=false;this.run=null;this.listed=false;
  }
  update(patch){
    super.update(patch);
    if(this.closed){this.listed=false;this.fail('接続が終了しました。',true);this.onRemote({type:'closed'});return;}
    if(this.state.ready&&!this.listed){this.listed=true;this.refresh();}
  }
  sendFrame(text){this.guard();if(this.channel?.readyState!=='open')throw Error('まだ接続できていません。');this.channel.send(text);}
  refresh(){this.sources=[];this.expected=0;this.listing=true;this.sendFrame(frame({type:'ai.list'}));this.onRemote({type:'listing'});}

  /** messages: [{role,content}] （最後はuser）。handlers: {delta(text), end({cancelled}), error(code)} */
  start(target,messages,handlers){
    this.guard();
    if(!this.state.ready)throw Error('PCとの接続を確認してください。');
    if(this.run)throw Error('実行中の依頼があります。');
    const id=crypto.randomUUID();
    const frames=runFrames(id,target,messages);
    this.run={id,handlers,seq:0,chars:0};
    try{for(const text of frames)this.sendFrame(text);}catch(error){this.run=null;throw error;}
    return id;
  }
  cancel(){if(this.run&&!this.closed&&this.channel?.readyState==='open'){try{this.sendFrame(frame({type:'ai.cancel',id:this.run.id}));}catch{/* the connection is already gone */}}}
  fail(message,closing=false){const run=this.run;this.run=null;if(run)run.handlers.error(closing?'byok_connection_lost':safeCode(message));}

  async receive(data){
    this.guard();
    if(typeof data!=='string')throw Error('binary');
    if(data.length<=4096&&data.includes('"verify"')){let probe;try{probe=JSON.parse(data);}catch{probe=null;}if(probe?.type==='verify')return super.receive(data);}
    if(!this.state.ready)throw Error('not ready');
    if(data.length>FRAME_MAX)throw Error('frame');
    this.handle(parseFrame(data));
  }
  handle(message){
    switch(message.type){
      case 'ai.sources':{
        if(!this.listing||!Number.isSafeInteger(message.total)||message.total<0||message.total>LIMITS.sources)throw Error('sources');
        this.expected=message.total;this.sources=[];if(message.total===0){this.listing=false;this.onRemote({type:'sources',sources:[]});}
        return;
      }
      case 'ai.source':{
        if(!this.listing||this.sources.length>=this.expected)throw Error('source');
        this.sources.push(readSource(message.source));
        if(this.sources.length===this.expected){this.listing=false;this.onRemote({type:'sources',sources:[...this.sources]});}
        return;
      }
      case 'ai.out':{
        const run=this.run;if(!run||message.id!==run.id||message.seq!==run.seq||typeof message.text!=='string')throw Error('out');
        run.seq++;run.chars+=[...message.text].length;
        if(run.chars>LIMITS.outputChars){this.cancel();this.fail('byok_response_too_large');return;}
        run.handlers.delta(message.text);return;
      }
      case 'ai.end':{const run=this.run;if(!run||message.id!==run.id)throw Error('end');this.run=null;run.handlers.end({cancelled:message.cancelled===true});return;}
      case 'ai.error':{
        const code=safeCode(message.code);
        if(this.run&&(message.id===this.run.id||message.id===null)){const run=this.run;this.run=null;run.handlers.error(code);return;}
        if(message.id===null){this.listing=false;this.onRemote({type:'error',code});return;}
        throw Error('error');
      }
      default:throw Error('unknown');
    }
  }
}
