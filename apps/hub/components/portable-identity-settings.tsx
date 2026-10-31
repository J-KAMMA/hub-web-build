"use client";

import React, { useCallback, useEffect, useState } from "react";

import { UiButton, UiInput } from "@/components/ui/primitives";
import {
  createRootKeyOnDevice,
  exportSignedBundle,
  forgetStoredRootKey,
  markRecoverySaved,
  passkeyPrfSupported,
  portabilityApi,
  publishRootKey,
  readStoredRootKey,
  restoreRootKeyFromRecovery,
  signMoveFor,
  unlockRootKey,
  type RecoveryFile,
  type ServerIdentity,
  type StoredRootKey,
} from "@/lib/portable-identity-client";

/*
 * 持ち運べる身元（DESIGN.md 2・3）の設定。
 * 鍵はこの端末の中だけで作り、署名もこの端末でする。Hub のサーバーへ送るのは公開鍵と署名済みの文書だけ。
 * 端末と回復ファイルの両方を失うと、鍵は誰にも戻せない。
 */

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > 64 * 1024 * 1024) throw new Error("file_too_large");
  return JSON.parse(await file.text());
}

export function PortableIdentitySettings({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [identity, setIdentity] = useState<ServerIdentity | null>(null);
  const [stored, setStored] = useState<StoredRootKey | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [refollow, setRefollow] = useState(true);

  const copy = ja ? {
    title: "持ち運べる身元",
    intro: "名前・フォロー・フォロワー・投稿を持って別のハブへ移れます。鍵はこの端末の中だけで作り、ハブのサーバーは秘密鍵を持ちません。鍵はログインにも、ウォレットにも使いません。",
    actor: "あなたのアドレス（actor）",
    key: "公開している根鍵",
    none: "なし",
    create: "根鍵を作る",
    passphrase: "回復ファイルのパスフレーズ（12文字以上）",
    recoveryTitle: "回復ファイル",
    recoveryText: "端末を失ったときに鍵を戻す唯一の手段です。ダウンロードして安全な場所に保管してください。ハブはこのファイルを持ちません。",
    recoverySaved: "回復ファイルを保存した",
    publish: "根鍵を公開する",
    publishNote: "公開すると、actor に公開鍵が載ります。旧ハブが止まった後でも、この鍵の署名で同じ人だと示せます。",
    exportTitle: "署名して書き出す",
    exportButton: "束（hub.account.bundle v2）を書き出す",
    exportNote: "投稿・フォロー・フォロワーの一覧を、根鍵の署名つきで書き出します。DM・ウォレット・メール・他サービスのデータは含まれません。",
    importTitle: "書き出しから取り込む",
    importNote: "署名が1か所でも合わない束は、全体を取り込みません。取り込んだ投稿は元の日時のまま「移転前の投稿」と表示され、外部へは配り直しません。",
    refollow: "フォローしていた相手へ、あらためてフォローを送る",
    selfMove: "旧ハブなしで移転を宣言する（自己署名）",
    selfMoveNote: "束にあったフォロワーのハブへ、根鍵の署名つきで移転を知らせます。そのハブが、以前にあなたの鍵を取得していたときだけ受け付けられます。Mastodon など、この方式に対応しない実装では、フォロワーに手動で追い直してもらう必要があります。",
    moveTitle: "移転する（旧ハブが動いている場合）",
    moveNote: "移転先で先に、この actor を別名（alsoKnownAs）に設定してください。移転後12か月は、このハブのあなたのページが移転先へ転送されます。移転後30日は新しい投稿ができず、続けての移転は30日あけます。",
    moveTarget: "移転先の actor URL",
    moveButton: "移転する",
    restore: "回復ファイルから戻す",
    forget: "この端末の鍵を消す",
    moved: "移転済み",
    working: "処理中です。",
  } : {
    title: "Portable identity",
    intro: "Take your name, follows, followers and posts to another Hub. The key is created only on this device; the Hub server never holds a private key. The key is not used for login or as a wallet.",
    actor: "Your address (actor)",
    key: "Published root key",
    none: "None",
    create: "Create a root key",
    passphrase: "Recovery file passphrase (12+ characters)",
    recoveryTitle: "Recovery file",
    recoveryText: "This is the only way to restore the key if you lose this device. Download it and keep it safe. The Hub does not keep a copy.",
    recoverySaved: "I saved the recovery file",
    publish: "Publish the root key",
    publishNote: "Publishing adds the public key to your actor. Even after your old Hub is gone, signatures from this key show you are the same person.",
    exportTitle: "Export, signed",
    exportButton: "Export bundle (hub.account.bundle v2)",
    exportNote: "Exports posts, follows and followers signed by your root key. DMs, wallets, email and other services' data are not included.",
    importTitle: "Import from an export",
    importNote: "A bundle with even one bad signature is rejected as a whole. Imported posts keep their original dates, are labelled as posted before the move, and are not re-distributed.",
    refollow: "Send follows again to the accounts you followed",
    selfMove: "Declare the move without the old Hub (self-signed)",
    selfMoveNote: "Tells the Hubs of your followers, signed by your root key. A Hub accepts it only if it had fetched your key earlier. Servers that do not support this (such as Mastodon) need followers to re-follow by hand.",
    moveTitle: "Move (the old Hub is running)",
    moveNote: "First set this actor as an alias (alsoKnownAs) at the new home. For 12 months this Hub redirects your page there. You cannot post on this actor for 30 days, and moves must be 30 days apart.",
    moveTarget: "New actor URL",
    moveButton: "Move",
    restore: "Restore from a recovery file",
    forget: "Remove the key from this device",
    moved: "Moved",
    working: "Working.",
  };

  const refresh = useCallback(async () => {
    setStored(readStoredRootKey());
    const result = await portabilityApi.identity().catch(() => null);
    if (result?.ok) setIdentity(result.body);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<string | void>) {
    if (busy) return;
    setBusy(true);
    setMessage(copy.working);
    try {
      setMessage((await action()) ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const unlock = () => unlockRootKey(passphrase || undefined);
  const actor = identity?.actorUrl ?? null;

  return (
    <div className="settings-card" aria-busy={busy}>
      <div className="settings-note">
        <strong>{copy.title}</strong>
        <p>{copy.intro}</p>
      </div>
      <dl>
        <dt>{copy.actor}</dt><dd>{actor ?? copy.none}</dd>
        <dt>{copy.key}</dt><dd>{identity?.rootKey ?? copy.none}</dd>
        {identity?.movedTo ? <><dt>{copy.moved}</dt><dd>{identity.movedTo}</dd></> : null}
      </dl>

      {!stored ? (
        <section>
          <UiInput type="password" autoComplete="new-password" aria-label={copy.passphrase} placeholder={copy.passphrase} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
          <UiButton
            disabled={busy || passphrase.length < 12}
            onClick={() => void run(async () => {
              const created = await createRootKeyOnDevice({ passphrase, label: "Hub root key", preferPasskey: passkeyPrfSupported() });
              const recovery: RecoveryFile = created.recovery;
              download(`hub-root-key-recovery-${created.did.slice(-8)}.json`, JSON.stringify(recovery));
              setRecoveryConfirmed(false);
              return ja ? "回復ファイルを保存してください。保存したら下で確認して公開できます。" : "Save the recovery file, then confirm below to publish.";
            })}
          >{copy.create}</UiButton>
          <label>
            <span>{copy.restore}</span>
            <input
              type="file"
              accept="application/json"
              disabled={busy || passphrase.length < 12}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void run(async () => {
                  await restoreRootKeyFromRecovery(await readJsonFile(file), passphrase, "Hub root key");
                  return ja ? "鍵を戻しました。" : "Key restored.";
                });
              }}
            />
          </label>
        </section>
      ) : (
        <section>
          <p>{copy.recoveryTitle}: {stored.recoverySaved ? "✓" : "—"}</p>
          {!stored.recoverySaved ? (
            <>
              <p>{copy.recoveryText}</p>
              <label>
                <input type="checkbox" checked={recoveryConfirmed} onChange={(event) => setRecoveryConfirmed(event.target.checked)} />
                {copy.recoverySaved}
              </label>
              <UiButton disabled={!recoveryConfirmed} onClick={() => { markRecoverySaved(); void refresh(); }}>OK</UiButton>
            </>
          ) : null}
          {stored.wrapped.kind === "recovery-passphrase" ? (
            <UiInput type="password" autoComplete="current-password" aria-label={copy.passphrase} placeholder={copy.passphrase} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
          ) : null}

          {actor && stored.recoverySaved && identity?.rootKey !== stored.did ? (
            <>
              <p>{copy.publishNote}</p>
              <UiButton
                tone="primary"
                disabled={busy}
                onClick={() => void run(async () => {
                  const key = await unlock();
                  const result = await publishRootKey(key, actor);
                  return result.ok ? (ja ? "公開しました。" : "Published.") : (result.body.code ?? result.body.error ?? "error");
                })}
              >{copy.publish}</UiButton>
            </>
          ) : null}

          {identity?.rootKey === stored.did ? (
            <>
              <h4>{copy.exportTitle}</h4>
              <p>{copy.exportNote}</p>
              <UiButton
                disabled={busy}
                onClick={() => void run(async () => {
                  const key = await unlock();
                  const bundle = await exportSignedBundle(key);
                  if ("error" in bundle) return bundle.error;
                  download(`hub-account-bundle-${new Date().toISOString().slice(0, 10)}.json`, bundle.json);
                  return ja ? `${bundle.posts}件の投稿を書き出しました。` : `Exported ${bundle.posts} posts.`;
                })}
              >{copy.exportButton}</UiButton>
            </>
          ) : null}

          <UiButton tone="danger" disabled={busy} onClick={() => { forgetStoredRootKey(); void refresh(); }}>{copy.forget}</UiButton>
        </section>
      )}

      <section>
        <h4>{copy.importTitle}</h4>
        <p>{copy.importNote}</p>
        <label>
          <input type="checkbox" checked={refollow} onChange={(event) => setRefollow(event.target.checked)} />
          {copy.refollow}
        </label>
        <input
          type="file"
          accept="application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(async () => {
              const result = await portabilityApi.importBundle(await readJsonFile(file), refollow);
              if (!result.ok) return result.body.error ?? result.body.code ?? "error";
              const summary = result.body as unknown as { imported: number; duplicates: number; provenance: string };
              return ja
                ? `${summary.imported}件を取り込みました（重複${summary.duplicates}件、${summary.provenance === "verified" ? "署名確認済み" : "出自未確認"}）。`
                : `Imported ${summary.imported} posts (${summary.duplicates} duplicates, ${summary.provenance}).`;
            });
          }}
        />
        {identity?.importHints && actor && stored && identity.rootKey === stored.did ? (
          <>
            <p>{copy.selfMoveNote}</p>
            <UiButton
              disabled={busy}
              onClick={() => void run(async () => {
                const key = await unlock();
                const move = await signMoveFor(key, identity.importHints!.oldActor, actor);
                const result = await portabilityApi.selfMove(move);
                return result.ok ? (ja ? "移転を知らせました。" : "Move sent.") : (result.body.code ?? result.body.error ?? "error");
              })}
            >{copy.selfMove}</UiButton>
          </>
        ) : null}
      </section>

      <section>
        <h4>{copy.moveTitle}</h4>
        <p>{copy.moveNote}</p>
        <UiInput aria-label={copy.moveTarget} placeholder={copy.moveTarget} value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} />
        <UiButton
          tone="danger"
          disabled={busy || !actor || !/^https?:\/\//.test(moveTarget)}
          onClick={() => void run(async () => {
            let statement: unknown;
            if (stored && identity?.rootKey === stored.did && actor) statement = await signMoveFor(await unlock(), actor, moveTarget);
            const result = await portabilityApi.move(moveTarget, statement);
            return result.ok ? (ja ? `移転しました（${result.body.notified}件へ通知）。` : `Moved (${result.body.notified} notified).`) : (result.body.code ?? result.body.error ?? "error");
          })}
        >{copy.moveButton}</UiButton>
      </section>

      <p role="status">{message}</p>
    </div>
  );
}
