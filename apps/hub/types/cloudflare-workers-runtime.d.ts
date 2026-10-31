declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = CloudflareEnv> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface DurableObjectState {
  acceptWebSocket(socket: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
  readonly storage: DurableObjectStorage;
}

/** 眠りを跨いで残るもの。**起きたときに読み直せるのはここだけ。** */
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(at: number | Date): Promise<void>;
}

interface WebSocket {
  /**
   * 接続そのものに、誰かを書いておく。
   *
   * **眠って起きたとき、どの口が誰かを思い出す手がかりがこれしかない。**
   * 手元の変数に持つと、眠った時点で消える。
   */
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** 秘密として置いた鍵。**生成物には出ないので、ここで足す。** */
interface CloudflareEnv {
  ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI?: string;
  /** Vault の場所と、世界にだけ渡された合言葉。 */
  VAULT_ORIGIN?: string;
  WORLD_SERVICE_TOKEN?: string;
}

/** Cloudflare が足す既定の憶え場。**標準の CacheStorage には無い。** */
interface CacheStorage {
  readonly default: Cache;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
