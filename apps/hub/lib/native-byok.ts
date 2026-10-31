// 自分のAPIキーで使うAI（BYOK）— モバイルアプリ（Android）の橋。
//
// 橋 `window.hubNativeByok` は Hub Mobile のネイティブ側が正確なHubオリジンにだけ入れる。
// Web版・デスクトップ版には無い。キーはアプリのネイティブ領域（Android Keystore で封印）に
// 置かれ、この画面のJS・Hubのサーバーには渡らない。窓が受け取るのは末尾の印だけ。
// 提供元への通信はアプリが直接行う。

export type ByokProviderKind = "anthropic" | "openai" | "gemini" | "openai-compatible";

export type ByokProviderInfo = {
  kind: ByokProviderKind;
  label: string;
  defaultBaseUrl: string | null;
  customEndpoint: boolean;
};

export type ByokStatus = {
  available: boolean;
  reason: "android_only" | "ios_unavailable" | null;
  maxConnections: number;
  providers: ByokProviderInfo[];
};

export type ByokConnection = {
  id: string;
  kind: ByokProviderKind;
  label: string;
  baseUrl: string;
  keyMask: string;
  enabled: boolean;
  createdAtMs: number;
};

export type ByokModelEntry = {
  connectionId: string;
  connectionLabel: string;
  kind: ByokProviderKind;
  modelId: string;
  name: string;
};

export type ByokModelsResponse = {
  models: ByokModelEntry[];
  errors: Array<{ connectionId: string; code: string }>;
};

export type ByokTestResult = { ok: boolean; code: string | null; modelCount: number };

export type ByokChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface NativeByokManager {
  isNativeByok: true;
  status(): Promise<ByokStatus>;
  listConnections(): Promise<ByokConnection[]>;
  addConnection(input: { kind: ByokProviderKind; label: string; apiKey: string; baseUrl?: string; enabled?: boolean }): Promise<ByokConnection>;
  updateConnection(input: { id: string; label?: string; apiKey?: string; baseUrl?: string; enabled?: boolean }): Promise<ByokConnection>;
  removeConnection(id: string): Promise<void>;
  testConnection(id: string): Promise<ByokTestResult>;
  listModels(id?: string): Promise<ByokModelsResponse>;
  generate(
    input: { connectionId: string; model: string; messages: ByokChatMessage[]; maxOutputTokens?: number; temperature?: number },
    onChunk: (text: string) => void,
    requestId?: string,
  ): Promise<{ cancelled: boolean; chars: number }>;
  cancel(requestId: string): Promise<void>;
}

declare global {
  interface Window {
    hubNativeByok?: NativeByokManager;
  }
}

export function nativeByokManager(): NativeByokManager | null {
  if (typeof window === "undefined") return null;
  return window.hubNativeByok?.isNativeByok === true ? window.hubNativeByok : null;
}

const MODEL_VALUE = /^byok:(c-[0-9a-f]{16}):(.{1,200})$/u;

/** モデル選択欄の値。接続IDとモデルIDだけで、キーも封印も含まない。 */
export function byokModelValue(connectionId: string, modelId: string): string {
  return `byok:${connectionId}:${modelId}`;
}

export function parseByokModelValue(value: string): { connectionId: string; modelId: string } | null {
  const match = MODEL_VALUE.exec(value);
  return match ? { connectionId: match[1], modelId: match[2] } : null;
}

export const BYOK_SETUP_VALUE = "byok:setup";

const MESSAGES: Record<string, string> = {
  byok_auth_failed: "キーが受け付けられませんでした。キーと利用権限を確認してください。",
  byok_quota_exceeded: "提供元の利用枠または残高が不足しています。提供元の管理画面で確認してください。",
  byok_rate_limited: "提供元の利用制限に達しました。少し待ってから再試行してください。",
  byok_model_not_found: "選んだモデルが見つかりません。モデル名を確認してください。",
  byok_bad_request: "提供元が要求を受け付けませんでした。モデルや入力の長さを見直してください。",
  byok_provider_unavailable: "提供元が一時的に利用できません。時間をおいて再試行してください。",
  byok_provider_error: "提供元がエラーを返しました。",
  byok_blocked: "提供元の安全機能により応答が止まりました。",
  byok_network_error: "提供元へ接続できません。通信を確認してください。",
  byok_timeout: "提供元の応答が時間内に返りませんでした。",
  byok_response_invalid: "提供元の応答を読み取れませんでした。接続先がOpenAI互換か確認してください。",
  byok_endpoint_invalid: "接続先のURLを確認してください。",
  byok_endpoint_insecure: "接続先は https のURLにしてください（http は端末内のアドレスだけ）。",
  byok_endpoint_fixed: "この提供元の接続先は変更できません。",
  byok_key_required_for_new_endpoint: "接続先を変えるときは、キーも入れ直してください。",
  byok_key_invalid: "キーの形式が正しくありません（空白や改行を含めないでください）。",
  byok_key_unavailable: "保存したキーを開けませんでした。キーを入れ直してください。",
  byok_label_invalid: "名前は1〜40文字で入力してください。",
  byok_model_invalid: "モデル名が正しくありません。",
  byok_prompt_invalid: "入力が空か、長すぎます。",
  byok_too_many_connections: "接続の上限に達しました。使わない接続を削除してください。",
  byok_connection_not_found: "接続が見つかりません。",
  byok_connection_disabled: "この接続は無効です。設定で有効にしてください。",
  byok_request_busy: "同じ実行がすでに進行中です。",
  byok_unavailable: "この端末では自分のAPIキーを安全に保管できないため使えません。",
  byok_android_only: "自分のAPIキーでの利用は、現在Androidアプリだけで使えます。",
  byok_ios_unavailable: "iOSでは自分のAPIキーでの利用に未対応です。",
  byok_origin_forbidden: "このページからは使えません。",
  byok_store_corrupt: "保存された接続情報を読み取れません。接続を作り直してください。",
  byok_store_unavailable: "接続情報を保存できません。",
};

/** ネイティブが返す分類コードを、画面に出せる文にする。キーや本文は含まれない。 */
export function byokErrorMessage(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const code = /byok_[a-z_]+/u.exec(raw)?.[0] ?? "";
  return MESSAGES[code] ?? "自分のAPIキーでの実行に失敗しました。";
}

/** 画面に出す前提の注記。料金は表示しない（提供元が利用者のアカウントへ直接請求する）。 */
export const BYOK_BILLING_NOTE = "料金は提供元（Anthropic・OpenAI・Google など）があなたのアカウントへ直接請求します。Hubは料金を扱いません。";
export const BYOK_PRIVACY_NOTE = "入力は、選んだ提供元へアプリから直接送られます。Hubのサーバーは経由せず、キーも受け取りません。";
