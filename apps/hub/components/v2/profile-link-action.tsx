"use client";

import { useCallback, useEffect, useState } from "react";

import { useHubWallet } from "@/components/hub-wallet-provider";

/*
 * 接続中のアドレスを署名でプロフィールへ連携する一連の流れ（challenge → 署名 → verify）。
 * /v2/account/payment の連携管理とハードウェアウォレット欄の両方が同じ手順を使う。
 */

export type ProfileWalletLink = { address: string; chainId: number; network: string; visibility: "private" | "public"; verifiedAt: string };

export async function fetchProfileWalletLinks(signal?: AbortSignal): Promise<ProfileWalletLink[]> {
  const response = await fetch("/api/wallet/links", { cache: "no-store", signal });
  if (!response.ok) throw new Error("links_unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload?.links) || !payload.links.every((item: Partial<ProfileWalletLink> | null) => item
    && [item.address, item.network, item.verifiedAt].every((value) => typeof value === "string")
    && Number.isSafeInteger(item.chainId) && Number(item.chainId) > 0
    && (item.visibility === "private" || item.visibility === "public"))) throw new Error("links_invalid");
  return payload.links as ProfileWalletLink[];
}

export function isProfileLinked(links: ProfileWalletLink[] | null, address: string | null | undefined, chainId: number | null | undefined) {
  if (!links || !address) return false;
  return links.some((link) => link.chainId === chainId && link.address.toLocaleLowerCase("en") === address.toLocaleLowerCase("en"));
}

/** 署名による連携を実行する。成功すると true。失敗の文言は message に入る。 */
export function useProfileLinkFlow(ja: boolean) {
  const wallet = useHubWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async (): Promise<boolean> => {
    if (!wallet.address || !wallet.chainId) return false;
    setBusy(true);
    setMessage(null);
    try {
      const challengeResponse = await fetch("/api/wallet/account-link/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: wallet.address, chainId: wallet.chainId }),
      });
      const challenge = await challengeResponse.json() as { challengeId?: string; typedData?: Record<string, unknown>; error?: string };
      if (!challengeResponse.ok || !challenge.challengeId || !challenge.typedData) {
        throw new Error(challenge.error || (ja ? "所有権の確認を開始できませんでした。" : "Could not start ownership check."));
      }
      const signature = await Promise.race([
        wallet.signProfileLink(JSON.stringify(challenge.typedData)),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error(ja ? "署名確認がタイムアウトしました。ウォレットの確認画面を閉じて、もう一度お試しください。" : "Signature check timed out. Close the wallet prompt and try again.")), 45_000);
        }),
      ]);
      const verifyResponse = await fetch("/api/wallet/account-link/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ challengeId: challenge.challengeId, address: wallet.address, typedData: challenge.typedData, signature }),
      });
      const verified = await verifyResponse.json() as { error?: string };
      if (!verifyResponse.ok) throw new Error(verified.error || (ja ? "所有権を確認できませんでした。" : "Could not verify ownership."));
      setMessage(ja ? "所有権を確認し、非公開でプロフィールに連携しました。" : "Verified and linked to your profile as private.");
      return true;
    } catch (caught) {
      setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "ウォレットを連携できませんでした。" : "Could not link the wallet."));
      return false;
    } finally {
      setBusy(false);
    }
  }, [ja, wallet]);

  return { busy, message, setMessage, run };
}

/** 接続済みアドレスの連携状態を調べ、未連携なら連携ボタンを出す。ハードウェア接続の直後に同じ欄で使う。 */
export function ProfileLinkInline({ ja }: { ja: boolean }) {
  const wallet = useHubWallet();
  const flow = useProfileLinkFlow(ja);
  const [links, setLinks] = useState<ProfileWalletLink[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setUnavailable(false);
    fetchProfileWalletLinks(controller.signal)
      .then((items) => { if (!controller.signal.aborted) setLinks(items); })
      .catch(() => { if (!controller.signal.aborted) { setLinks(null); setUnavailable(true); } });
    return () => controller.abort();
  }, [wallet.address, wallet.chainId]);

  const linked = isProfileLinked(links, wallet.address, wallet.chainId);
  const link = async () => {
    if (await flow.run()) {
      try { setLinks(await fetchProfileWalletLinks()); } catch { /* 表示だけの再取得。失敗しても連携は済んでいる */ }
    }
  };

  if (unavailable && !flow.message) return null;
  return (
    <div className="v2-wallet__profile-link" role="group" aria-label={ja ? "プロフィール連携" : "Profile linking"}>
      {linked ? (
        <p role="status">{ja ? "このアドレスはプロフィールに連携済みです。" : "This address is linked to your profile."}</p>
      ) : (
        <>
          <p>{ja ? "署名するとこのアドレスをプロフィールに連携できます（チップ・ランキング用。非公開で始まります）。" : "Sign to link this address to your profile (tips and rankings; starts private)."}</p>
          <button type="button" className="v2-button v2-button--primary" onClick={() => void link()} disabled={flow.busy || links === null}>
            {flow.busy ? (ja ? "署名を確認中…" : "Verifying signature…") : (ja ? "このアドレスをプロフィールに連携" : "Link this address to your profile")}
          </button>
        </>
      )}
      {flow.message ? <p role="status">{flow.message}</p> : null}
    </div>
  );
}
