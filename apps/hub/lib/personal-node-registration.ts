/**
 * この端末をノードとして登録する手順。
 *
 * 二つのものが別々の場所にある。**秘密鍵はこの端末にしかなく、ハブの
 * セッションはブラウザにしかない。** どちらも相手側へ渡せない——鍵を渡せば
 * 端末が持つ意味が消え、セッションを渡せば端末がアカウントとして振る舞える。
 *
 * だから署名だけを端末に頼む。ハブから確認文字列をもらい、端末に署名させ、
 * 署名だけを持ち帰って登録を終える。鍵は端末から一歩も出ない。
 *
 *   ブラウザ            端末                ハブ
 *      │  公開鍵を訊く   │                   │
 *      │ ─────────────> │                   │
 *      │  challenge を頼む                   │
 *      │ ──────────────────────────────────> │
 *      │  署名を頼む     │                   │
 *      │ ─────────────> │                   │
 *      │  署名で登録     │                   │
 *      │ ──────────────────────────────────> │
 */

const RUNNER = "http://127.0.0.1:43127";

export type NodeIdentity = {
  publicKeyJwk: { kty: string; crv: string; x: string; y: string } | null;
  keyThumbprint: string | null;
  hubUrl: string;
};

export type RegistrationResult =
  | { ok: true; keyThumbprint: string; nodeUrl: string }
  | { ok: false; reason: string };

type Fetcher = typeof fetch;

/** 端末の身元。鍵が無ければ登録できない。 */
export async function readNodeIdentity(token: string, doFetch: Fetcher = fetch): Promise<NodeIdentity | null> {
  const response = await doFetch(`${RUNNER}/node/status`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) return null;
  return (await response.json()) as NodeIdentity;
}

/** 端末に署名を頼む。**渡すのは確認文字列だけで、鍵は返ってこない。** */
export async function askTheMachineToSign(
  token: string,
  challenge: string,
  doFetch: Fetcher = fetch
): Promise<string | null> {
  const response = await doFetch(`${RUNNER}/node/sign`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
    body: challenge
  });
  if (!response.ok) return null;
  return (await response.text()).trim() || null;
}

/**
 * 登録を通しでやる。
 *
 * 途中で止まる理由はいくつもあり、**どこで止まったかが分からないと直せない**。
 * それぞれ別の言葉で返す。
 */
export async function registerThisMachine(
  token: string,
  nodeUrl: string,
  doFetch: Fetcher = fetch
): Promise<RegistrationResult> {
  const identity = await readNodeIdentity(token, doFetch);
  if (!identity) return { ok: false, reason: "この端末に問い合わせられません" };
  if (!identity.publicKeyJwk) return { ok: false, reason: "この端末に身元鍵がありません" };

  const challengeResponse = await doFetch("/api/core/personal-node", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "challenge", nodeUrl, publicKeyJwk: identity.publicKeyJwk })
  });
  if (challengeResponse.status === 401) return { ok: false, reason: "ハブにサインインしてください" };
  if (!challengeResponse.ok) return { ok: false, reason: "ハブが確認文字列を出しませんでした" };
  const challenge = (await challengeResponse.json()) as { challengeId?: string; challenge?: string };
  if (!challenge.challengeId || !challenge.challenge) {
    return { ok: false, reason: "ハブの応答に確認文字列がありません" };
  }

  const signature = await askTheMachineToSign(token, challenge.challenge, doFetch);
  if (!signature) return { ok: false, reason: "この端末が署名しませんでした" };

  const registered = await doFetch("/api/core/personal-node", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "register", challengeId: challenge.challengeId, signature })
  });
  if (!registered.ok) return { ok: false, reason: "ハブが登録を受け付けませんでした" };
  const result = (await registered.json()) as { registered?: boolean; nodeUrl?: string; keyThumbprint?: string };
  if (!result.registered) return { ok: false, reason: "登録されませんでした" };

  // 指紋が食い違うなら、署名した鍵と登録された鍵が違う。黙って通すと、
  // 後で「登録したのに配信できない」という形で出てくる。
  if (identity.keyThumbprint && result.keyThumbprint && identity.keyThumbprint !== result.keyThumbprint) {
    return { ok: false, reason: "登録された鍵が、この端末の鍵と一致しません" };
  }
  return { ok: true, keyThumbprint: result.keyThumbprint ?? identity.keyThumbprint ?? "", nodeUrl: result.nodeUrl ?? nodeUrl };
}

/** 端末に積まれた、まだ送れていない出来事。 */
export type PendingEvent = {
  sequence: number;
  hash: string;
  event: unknown;
  signature: string;
};

export type DeliveryResult = {
  delivered: number;
  /** 止まった理由。全部送れたなら無い。 */
  stoppedBecause?: string;
};

export type PublicContentPreview = {
  previewId: string;
  contentId: string;
  nodeUrl: string;
  kind: string;
  title: string;
  body: string;
  language: string;
  characterCount: number;
  byteLength: number;
  artifact?: {
    fileName: string;
    mediaType: string;
    byteLength: number;
    digest: string;
    blobUri: string;
    chunkCount: number;
  };
  visibility: "public" | "private";
  recipientIds: string[];
  mirrorPolicy: string;
  aiTrainingPolicy: string;
  derivativesPolicy: string;
  expiresAt: string;
};

export type ArtifactKind =
  | "image"
  | "audio"
  | "video"
  | "book"
  | "document"
  | "file"
  | "game"
  | "software"
  | "product"
  | "catalog";

type ArtifactUpload = {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  const block = 0x8000;
  for (let start = 0; start < bytes.length; start += block) {
    binary += String.fromCharCode(...bytes.subarray(start, start + block));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * ファイルを端末内で検証・確定し、公開前プレビューまで作る。
 * この関数は公開イベントを作らない。公開は queuePublicContent の明示呼び出しだけ。
 */
export async function preparePublicArtifact(
  token: string,
  file: File,
  metadata: { kind: ArtifactKind; title: string; language: string },
  onProgress: (uploadedChunks: number, totalChunks: number) => void = () => undefined,
  doFetch: Fetcher = fetch,
  recipientPeerIds: string[] = []
): Promise<PublicContentPreview> {
  if (file.size < 1 || file.size > 256 * 1024 * 1024) {
    throw new Error("ファイルは1バイト以上256MiB以下にしてください。");
  }
  const started = await doFetch(`${RUNNER}/node/artifacts/begin`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mediaType: file.type || "application/octet-stream",
      byteLength: file.size,
      kind: metadata.kind,
      title: metadata.title,
      language: metadata.language
    })
  });
  if (!started.ok) throw new Error("このファイルの保存を開始できません。");
  const upload = (await started.json()) as ArtifactUpload;
  if (!upload.uploadId || upload.chunkSize < 1 || upload.totalChunks < 1) {
    throw new Error("端末から不正なアップロード情報が返りました。");
  }

  for (let index = 0; index < upload.totalChunks; index += 1) {
    const start = index * upload.chunkSize;
    const bytes = new Uint8Array(await file.slice(start, Math.min(start + upload.chunkSize, file.size)).arrayBuffer());
    const body = JSON.stringify({ data: base64Url(bytes) });
    let stored = false;
    for (let attempt = 1; attempt <= 3 && !stored; attempt += 1) {
      try {
        const response = await doFetch(`${RUNNER}/node/artifacts/${encodeURIComponent(upload.uploadId)}/chunks/${index}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body
        });
        if (response.ok) stored = true;
        else if (response.status === 409 || response.status < 500) break;
      } catch {
        // 同じuploadId・index・bytesだけを再送する。3回失敗したら確定へ進まない。
      }
    }
    if (!stored) throw new Error(`${index + 1}個目の断片を保存できません。再試行してください。`);
    onProgress(index + 1, upload.totalChunks);
  }

  const privateDelivery = recipientPeerIds.length > 0;
  const finalized = await doFetch(`${RUNNER}/node/artifacts/${encodeURIComponent(upload.uploadId)}/${privateDelivery ? "finalize-private" : "finalize"}`, {
    method: "POST",
    headers: privateDelivery
      ? { authorization: `Bearer ${token}`, "content-type": "application/json" }
      : { authorization: `Bearer ${token}` },
    body: privateDelivery ? JSON.stringify({ recipientPeerIds }) : undefined
  });
  if (!finalized.ok) throw new Error("全断片の検証・確定に失敗しました。");
  const preview = (await finalized.json()) as PublicContentPreview;
  if (!preview.artifact) throw new Error("端末からartifact情報が返りませんでした。");
  return preview;
}

export type PublicContentReceipt = {
  status: "queued";
  contentId: string;
  sequence: number;
  eventHash: string;
};

export async function previewPublicContent(
  token: string,
  draft: { kind: string; title: string; body: string; language: string },
  doFetch: Fetcher = fetch
): Promise<PublicContentPreview> {
  const response = await doFetch(`${RUNNER}/node/content/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(draft)
  });
  if (!response.ok) throw new Error("公開条件を確認できません。公開URLと入力を確認してください。");
  return (await response.json()) as PublicContentPreview;
}

export async function previewPrivateContent(
  token: string,
  draft: { kind: string; title: string; body: string; language: string; recipientPeerIds: string[] },
  doFetch: Fetcher = fetch
): Promise<PublicContentPreview> {
  const response = await doFetch(`${RUNNER}/node/content/private/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(draft)
  });
  if (!response.ok) throw new Error("暗号化プレビューを作れません。宛先ピアと公開URLを確認してください。");
  return (await response.json()) as PublicContentPreview;
}

export type PinnedPeer = {
  peerId: string;
  nodeId: string;
  signingKeyThumbprint: string;
  encryptionKeyThumbprint: string;
  pinnedAt: string;
};

export type PeerPreview = {
  previewId: string;
  nodeId: string;
  signingKeyThumbprint: string;
  encryptionKeyThumbprint: string;
  expiresAt: string;
};

export async function listPeers(token: string, doFetch: Fetcher = fetch): Promise<PinnedPeer[]> {
  const response = await doFetch(`${RUNNER}/node/peers`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("確認済みピアを取得できません。");
  const value = await response.json();
  return Array.isArray(value) ? value as PinnedPeer[] : [];
}

export async function previewPeer(token: string, nodeUrl: string, doFetch: Fetcher = fetch): Promise<PeerPreview> {
  const response = await doFetch(`${RUNNER}/node/peers/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ nodeUrl })
  });
  if (!response.ok) throw new Error("ピア身元を確認できません。公開HTTPS URLを確認してください。");
  return (await response.json()) as PeerPreview;
}

export async function confirmPeer(token: string, previewId: string, doFetch: Fetcher = fetch): Promise<PinnedPeer> {
  const response = await doFetch(`${RUNNER}/node/peers/confirm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ previewId, confirmedFingerprints: true })
  });
  if (!response.ok) throw new Error("鍵指紋を固定できません。鍵変更は自動承認されません。");
  return (await response.json()) as PinnedPeer;
}

export async function deliverPeerEvent(
  token: string,
  peerId: string,
  sequence: number,
  doFetch: Fetcher = fetch
): Promise<{ status: "accepted" | "ready"; deliveryId: string }> {
  const response = await doFetch(`${RUNNER}/node/peers/${encodeURIComponent(peerId)}/events/${sequence}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("宛先ピアへ配送できません。暗号文は同じ配送IDで再送できます。");
  return (await response.json()) as { status: "accepted" | "ready"; deliveryId: string };
}

export type PeerInboxItem = {
  deliveryId: string;
  status: "accepted" | "ready";
  senderNodeId: string;
  contentId: string;
  kind: string;
  title?: string;
  mediaType: string;
  byteLength: number;
  receivedAt: string;
};

export async function listPeerInbox(token: string, doFetch: Fetcher = fetch): Promise<PeerInboxItem[]> {
  const response = await doFetch(`${RUNNER}/node/inbox`, {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store"
  });
  if (!response.ok) throw new Error("受信原本を取得できません。");
  const value = await response.json();
  return Array.isArray(value) ? value as PeerInboxItem[] : [];
}

export async function decryptPeerContent(token: string, deliveryId: string, doFetch: Fetcher = fetch): Promise<{
  contentId: string; mediaType: string; data: string; text?: string;
}> {
  const response = await doFetch(`${RUNNER}/node/inbox/${encodeURIComponent(deliveryId)}/decrypt`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("この端末では復号できません。宛先・鍵・暗号文を確認してください。");
  return (await response.json()) as { contentId: string; mediaType: string; data: string; text?: string };
}

export async function queuePublicContent(
  token: string,
  previewId: string,
  doFetch: Fetcher = fetch
): Promise<PublicContentReceipt> {
  const response = await doFetch(`${RUNNER}/node/content/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ previewId, confirmedPublic: true })
  });
  if (!response.ok) throw new Error("配信待ちへ追加できません。もう一度プレビューしてください。");
  return (await response.json()) as PublicContentReceipt;
}

/**
 * 積まれた出来事をハブへ流す。
 *
 * **1つ失敗したらそこで止める。** 連鎖なので、飛ばして次を送るとゲートウェイは
 * 番号が合わないと言って拒み、以後すべてが詰まる。送れた分だけ印を付けて、
 * 残りは次の機会に回す。
 *
 * 印を付けるのは**受け取られたと分かってから**。先に付けると、落ちた出来事が
 * 送られないまま「送った」ことになり、連鎖に穴が開く。
 */
export async function deliverPendingEvents(token: string, doFetch: Fetcher = fetch): Promise<DeliveryResult> {
  const listed = await doFetch(`${RUNNER}/node/events`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!listed.ok) return { delivered: 0, stoppedBecause: "この端末に問い合わせられません" };
  const pending = (await listed.json()) as PendingEvent[];

  let delivered = 0;
  for (const item of pending) {
    const sent = await doFetch("/api/core/personal-node", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "event", event: item.event, signature: item.signature })
    });
    if (sent.status === 401) return { delivered, stoppedBecause: "ハブにサインインしてください" };
    if (!sent.ok) return { delivered, stoppedBecause: `#${item.sequence} が受け取られませんでした` };
    const result = (await sent.json().catch(() => ({}))) as { accepted?: boolean };
    if (result.accepted === false) {
      return { delivered, stoppedBecause: `#${item.sequence} が拒まれました` };
    }

    const marked = await doFetch(`${RUNNER}/node/events/${item.sequence}/delivered`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    if (!marked.ok) {
      // 送れたのに印を付けられない。次も同じものを送ることになるので、
      // 黙って進めない。
      return { delivered, stoppedBecause: `#${item.sequence} は届いたが記録できませんでした` };
    }
    delivered += 1;
  }
  return { delivered };
}
