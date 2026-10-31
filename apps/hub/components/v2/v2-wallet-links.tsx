"use client";

import { useCallback, useEffect, useState } from "react";

import { HubWalletButton } from "@/components/hub-wallet-button";
import { V2Button } from "@/components/v2/v2-button";
import { V2Skeleton } from "@/components/v2/v2-skeleton";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { useProfileLinkFlow } from "@/components/v2/profile-link-action";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

/*
 * ウォレット連携の管理。ページ内ウォレット本体は /v2/wallet。
 * ここに残るのは Hub の機能だけ: 接続中のウォレット（ページ内・拡張機能・
 * 外部EIP-1193のいずれか）が渡すアドレスを、署名で本人確認してプロフィールに
 * 連携/解除する。連携はチップの受取・ランキング・ガバナンスのための
 * Hub 側データであり、ウォレット操作ではない。
 */

type WalletLink = { address: string; chainId: number; network: string; visibility: "private" | "public"; verifiedAt: string };

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function V2WalletLinks({ locale }: { locale: string }) {
  const ja = locale === "ja";
  const wallet = useHubWallet();
  const [links, setLinks] = useState<WalletLink[] | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [linksRevision, setLinksRevision] = useState(0);
  const flow = useProfileLinkFlow(ja);
  const [unlinkMessage, setMessage] = useState<string | null>(null);
  const busy = flow.busy;
  const message = unlinkMessage ?? flow.message;

  const loadLinks = useCallback(async () => {
    const response = await fetch("/api/wallet/links", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload?.links)) throw new Error("links_unavailable");
    return payload.links as WalletLink[];
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLinks(null);
    setLinksError(false);
    fetch("/api/wallet/links", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("links_unavailable");
        const payload = await response.json();
        if (!Array.isArray(payload?.links) || !payload.links.every((item: Partial<WalletLink> | null) => item
          && [item.address, item.network, item.verifiedAt].every((value) => typeof value === "string")
          && Number.isSafeInteger(item.chainId) && Number(item.chainId) > 0
          && (item.visibility === "private" || item.visibility === "public"))) throw new Error("links_invalid");
        return payload.links as WalletLink[];
      })
      .then((items) => { if (!controller.signal.aborted) setLinks(items); })
      .catch(() => { if (!controller.signal.aborted) setLinksError(true); });
    return () => controller.abort();
  }, [linksRevision]);

  const currentLink = links?.find(
    (link) => link.chainId === wallet.chainId
      && link.address.toLocaleLowerCase("en") === wallet.address?.toLocaleLowerCase("en"),
  );

  const linkWallet = async () => {
    if (await flow.run()) setLinks(await loadLinks().catch(() => links));
  };

  const unlink = async (link: WalletLink) => {
    if (!window.confirm(ja ? `${short(link.address)}（${link.network}）の連携を外しますか。` : `Unlink ${short(link.address)} on ${link.network}?`)) return;
    try {
      const response = await fetch("/api/wallet/links", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: link.address, chainId: link.chainId }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      setLinks((current) => (current ?? []).filter((item) => !(item.address === link.address && item.chainId === link.chainId)));
      setMessage(null);
      flow.setMessage(null);
    } catch (caught) {
      setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "連携を外せませんでした。" : "Could not unlink."));
    }
  };

  const connected = wallet.status === "connected" && Boolean(wallet.address);

  return (
    <div className="v2-wallet">
      {message ? <p className="v2-note" role="status">{message}</p> : null}

      <section id="v2-wallet-links-connect" className="v2-msec" aria-labelledby="v2-wallet-links-connect-title">
        <header className="v2-msec__head"><h2 id="v2-wallet-links-connect-title" className="v2-column__title v2-column__title--section">{ja ? "ウォレットの接続" : "Wallet connection"}</h2></header>
        <div className="v2-wallet__row">
          <div className="v2-wallet__row-body">
            {connected && wallet.address
              ? <><span className="v2-wallet__address">{wallet.address}</span><small>{`Chain ID ${wallet.chainId} · ${wallet.kind}`}</small></>
              : <><span>{ja ? "ウォレットは接続されていません。" : "No wallet connected."}</span><small>{wallet.error || (ja ? "ページ内ウォレット（/v2/wallet）、Hub Wallet 拡張、または外部ウォレットを使います。Hub は秘密鍵を受け取りません。" : "Use the in-page wallet (/v2/wallet), the Hub Wallet extension, or an external wallet. Hub never receives private keys.")}</small></>}
          </div>
          <HubWalletButton />
        </div>
        {wallet.status === "unavailable" ? (
          <details className="v2-wallet__install">
            <summary>{ja ? "開発者向け：拡張機能を手動で入れる" : "For developers: install the extension manually"}</summary>
            <p className="v2-note">{ja
              ? "ページ内ウォレットは /v2/wallet で作成できます。他サイトでも使いたい場合は Hub Wallet 拡張機能をインストールします。"
              : "Create the in-page wallet at /v2/wallet. To use it on other sites, install the Hub Wallet extension."}</p>
            <ol className="v2-wallet__steps">
              <li>{ja ? "zip をダウンロードして解凍" : "Download and unzip"}</li>
              <li>{ja ? "chrome://extensions でデベロッパーモードを有効化" : "Enable developer mode at chrome://extensions"}</li>
              <li>{ja ? "「パッケージ化されていない拡張機能を読み込む」で解凍したフォルダを選択" : "Use “Load unpacked” and select the unzipped folder"}</li>
            </ol>
            <V2Button href="/downloads/hub-wallet-extension.zip" icon="wallet" label={ja ? "Hub Wallet 拡張機能をダウンロード" : "Download Hub Wallet extension"} />
          </details>
        ) : null}
      </section>

      <section id="v2-wallet-links-list" className="v2-msec" aria-labelledby="v2-wallet-links-list-title">
        <header className="v2-msec__head">
          <h2 id="v2-wallet-links-list-title" className="v2-column__title v2-column__title--section">{ja ? "連携済みのウォレット" : "Linked wallets"}</h2>
          <span className="v2-msec__note">{links ? (ja ? `${links.length}件` : `${links.length}`) : ""}</span>
        </header>
        {linksError ? <div role="status"><p className="v2-error">{ja ? "連携の一覧を取得できませんでした。" : "Could not load linked wallets."}</p><button type="button" onClick={() => setLinksRevision((current) => current + 1)}>{ja ? "連携を再読み込み" : "Retry linked wallets"}</button></div> : links === null ? <V2Skeleton kind="lines" count={3} japanese={ja} /> : (
          <>
            {links.length ? (
              <ul className="v2-wallet__links">
                {links.map((link) => (
                  <li key={`${link.chainId}:${link.address}`} className="v2-wallet__link">
                    <div className="v2-wallet__row-body">
                      <span className="v2-wallet__address">{link.address}</span>
                      <small>{link.network} · {link.visibility === "public" ? (ja ? "公開" : "Public") : (ja ? "非公開" : "Private")} · {ja ? "確認 " : "verified "}<V2RelativeTime value={link.verifiedAt} locale={locale} /></small>
                    </div>
                    <V2Button icon="link-off" label={ja ? "連携を外す" : "Unlink"} onClick={() => void unlink(link)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="v2-note">{ja ? "連携済みのウォレットはありません。チップの受け取りやランキングに使います。" : "No linked wallets. Used for receiving tips, rankings, and governance."}</p>
            )}
            {connected && !currentLink ? (
              <V2Button variant="primary" icon="wallet" label={busy ? (ja ? "署名を確認中…" : "Verifying signature…") : (ja ? "接続中のアドレスを署名して連携" : "Sign and link the connected address")} onClick={() => void linkWallet()} />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
