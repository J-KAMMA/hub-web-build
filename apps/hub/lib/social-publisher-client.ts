const ACCOUNT_API = "/account/api/v1";
const PUBLISHER_API = "/social-publisher/api/v1";

export type SocialPublishReceipt = {
  destination: SocialProvider;
  status: "queued" | "submitted" | "succeeded" | "failed" | "unknown";
  externalUrl?: string | null;
  lastErrorCategory?: string | null;
};

export type SocialTextProvider = "threads" | "x";
export type SocialProvider = SocialTextProvider | "youtube";
export const SOCIAL_TEXT_PROVIDERS: SocialTextProvider[] = ["x", "threads"];

export type YouTubePreview = {
  previewId: string;
  rendered: {
    title: string;
    description: string;
    privacyStatus: "private" | "unlisted" | "public";
    fileName: string;
    videoSize: number;
    contentType: string;
    chunkSize: number;
    chunkSha256: string[];
    hubPost: { audience: "public" | "followers"; body: string } | null;
  };
};

export type YouTubeUploadProgress = {
  status: "initiated" | "uploading" | "succeeded";
  nextOffset: number;
  totalSize: number;
  externalId?: string;
  externalUrl?: string;
};

async function responseBody(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function issueAssertion(): Promise<string> {
  let response = await fetch(`${ACCOUNT_API}/assertions/social-publisher`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
  if (response.status === 403) {
    const linked = await fetch(`${ACCOUNT_API}/links/social-publisher`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
    if (!linked.ok) throw new Error(linked.status === 403 ? "外部投稿の有効化には、Accountへ再ログインしてから10分以内の確認が必要です。" : "外部投稿サービスを有効化できませんでした。");
    response = await fetch(`${ACCOUNT_API}/assertions/social-publisher`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
  }
  const body = await responseBody(response);
  if (!response.ok || typeof body?.assertion !== "string") throw new Error("外部投稿の認証を確認できませんでした。");
  return body.assertion;
}

async function publisher(path: string, init?: RequestInit) {
  const assertion = await issueAssertion();
  return fetch(`${PUBLISHER_API}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { authorization: `Bearer ${assertion}`, accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
}

export async function getSocialConnections(): Promise<Array<{ provider: SocialProvider; displayName?: string | null }>> {
  const response = await publisher("/connections");
  const body = await responseBody(response);
  if (!response.ok || !Array.isArray(body?.connections)) throw new Error("外部投稿の接続状態を確認できませんでした。");
  return body.connections as Array<{ provider: SocialProvider; displayName?: string | null }>;
}

export async function startSocialOAuth(provider: SocialProvider) {
  const response = await publisher(`/oauth/${provider}/start`, { method: "POST", body: JSON.stringify({ returnTo: window.location.href }) });
  const body = await responseBody(response);
  if (!response.ok || typeof body?.authorizationUrl !== "string") throw new Error("外部サービスの接続を開始できませんでした。");
  window.location.assign(body.authorizationUrl);
}

export async function disconnectSocialProvider(provider: SocialProvider) {
  const response = await publisher(`/connections/${provider}`, { method: "DELETE" });
  if (!response.ok) throw new Error("外部サービスとの接続を解除できませんでした。");
}

export async function prepareXCrossPost(idempotencyKey: string, body: string): Promise<{ previewId: string; text: string }> {
  const response = await publisher("/previews", { method: "POST", body: JSON.stringify({ idempotencyKey, body, destinations: ["x"] }) });
  const payload = await responseBody(response);
  const rendered = payload?.rendered as { x?: { text?: unknown } } | undefined;
  if (!response.ok || typeof payload?.previewId !== "string" || typeof rendered?.x?.text !== "string") throw new Error("X投稿の確定プレビューを作成できませんでした。");
  return { previewId: payload.previewId, text: rendered.x.text };
}

export async function prepareTextCrossPost(idempotencyKey: string, body: string, destinations: SocialTextProvider[]): Promise<{ previewId: string; rendered: Partial<Record<SocialTextProvider, { text: string }>> }> {
  const response = await publisher("/previews", { method: "POST", body: JSON.stringify({ idempotencyKey, body, destinations }) });
  const payload = await responseBody(response);
  const rendered = payload?.rendered as Partial<Record<SocialTextProvider, { text?: unknown }>> | undefined;
  const valid = rendered && destinations.every((provider) => typeof rendered[provider]?.text === "string");
  if (!response.ok || typeof payload?.previewId !== "string" || !valid) throw new Error("外部投稿の確定プレビューを作成できませんでした。");
  return { previewId: payload.previewId, rendered: rendered as Partial<Record<SocialTextProvider, { text: string }>> };
}

export async function commitXCrossPost(previewId: string): Promise<SocialPublishReceipt> {
  const response = await publisher(`/previews/${encodeURIComponent(previewId)}/commit`, { method: "POST", body: JSON.stringify({ confirmedDestinations: ["x"] }) });
  const payload = await responseBody(response);
  const receipts = payload?.receipts;
  if (!response.ok || !Array.isArray(receipts)) throw new Error("Hub投稿は完了しましたが、Xへの送信結果を確認できませんでした。");
  const receipt = receipts.find((item) => item && typeof item === "object" && (item as { destination?: unknown }).destination === "x") as SocialPublishReceipt | undefined;
  if (!receipt) throw new Error("Hub投稿は完了しましたが、Xの送信レシートがありません。");
  return receipt;
}

export async function commitTextCrossPost(previewId: string, destinations: SocialTextProvider[]): Promise<SocialPublishReceipt[]> {
  const response = await publisher(`/previews/${encodeURIComponent(previewId)}/commit`, { method: "POST", body: JSON.stringify({ confirmedDestinations: [...destinations].sort() }) });
  const payload = await responseBody(response);
  if (!response.ok || !Array.isArray(payload?.receipts)) throw new Error("Hub投稿は完了しましたが、外部サービスへの送信結果を確認できませんでした。");
  return (payload.receipts as SocialPublishReceipt[]).filter((receipt) => destinations.includes(receipt.destination as SocialTextProvider));
}

export async function prepareYouTubePublish(idempotencyKey: string, input: YouTubePreview["rendered"]): Promise<YouTubePreview> {
  const response = await publisher("/previews", { method: "POST", body: JSON.stringify({ idempotencyKey, body: input.description, destinations: ["youtube"], youtube: input }) });
  const payload = await responseBody(response);
  const rendered = (payload?.rendered as { youtube?: YouTubePreview["rendered"] } | undefined)?.youtube;
  if (!response.ok || typeof payload?.previewId !== "string" || !rendered) throw new Error("YouTube投稿の確定プレビューを作成できませんでした。");
  return { previewId: payload.previewId, rendered };
}

export async function commitYouTubePublish(previewId: string): Promise<YouTubeUploadProgress> {
  const response = await publisher(`/previews/${encodeURIComponent(previewId)}/commit`, { method: "POST", body: JSON.stringify({ confirmedDestinations: ["youtube"] }) });
  const payload = await responseBody(response);
  const upload = payload?.upload as Partial<YouTubeUploadProgress> | undefined;
  if (!response.ok || !upload || typeof upload.nextOffset !== "number" || typeof upload.totalSize !== "number") throw new Error("YouTubeの再開可能アップロードを開始できませんでした。");
  return { status: upload.status === "succeeded" ? "succeeded" : upload.status === "uploading" ? "uploading" : "initiated", nextOffset: upload.nextOffset, totalSize: upload.totalSize };
}

export async function uploadYouTubeChunk(previewId: string, bytes: Blob, start: number, total: number): Promise<YouTubeUploadProgress> {
  const assertion = await issueAssertion();
  const end = start + bytes.size - 1;
  const response = await fetch(`${PUBLISHER_API}/previews/${encodeURIComponent(previewId)}/youtube/chunks`, {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: { authorization: `Bearer ${assertion}`, "content-type": bytes.type || "application/octet-stream", "content-range": `bytes ${start}-${end}/${total}` },
    body: bytes,
  });
  const payload = await responseBody(response);
  if (!response.ok || (payload?.status !== "uploading" && payload?.status !== "succeeded") || typeof payload.nextOffset !== "number" || typeof payload.totalSize !== "number") {
    const error = new Error(typeof payload?.error === "string" ? payload.error : "YouTubeへの動画送信が中断されました。");
    Object.assign(error, { reconciliationRequired: payload?.error === "reconciliation_required" || response.status >= 500 });
    throw error;
  }
  return payload as unknown as YouTubeUploadProgress;
}

export async function reconcileYouTubePublish(previewId: string): Promise<YouTubeUploadProgress> {
  const response = await publisher(`/previews/${encodeURIComponent(previewId)}/youtube/reconcile`, { method: "POST", body: "{}" });
  const payload = await responseBody(response);
  if (!response.ok || (payload?.status !== "uploading" && payload?.status !== "succeeded") || typeof payload.nextOffset !== "number" || typeof payload.totalSize !== "number") throw new Error("YouTubeの受信済み位置を確認できませんでした。自動再送は行いません。");
  return payload as unknown as YouTubeUploadProgress;
}

export function renderXPreview(body: string) {
  return Array.from(body.trim()).slice(0, 280).join("");
}

export function renderSocialPreview(provider: SocialTextProvider, body: string) {
  return Array.from(body.trim()).slice(0, provider === "x" ? 280 : 500).join("");
}
