"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { commerceApiUrl, commerceRequest } from "@/lib/commerce-client";
import { productPriceLabels, readPublicProduct, type Product } from "@/lib/commerce-product";
import { readWalletOrderSession } from "@/lib/wallet-order-session";

/*
 * ストアの作品頁の購入の箱（2026-10-18、ゲームの店の裏側）。
 *  - 無料: 「ライブラリに追加」。Commerce の注文は作らない（Hub が記録する）。
 *  - 有料: 価格は Commerce の公開 API をブラウザから直接読み、Commerce の taxIncluded で税込を大きく出す。
 *    「購入」は Commerce のデジタルの売り場（この商品だけ）へ。支払いはブラウザから Commerce へ直接で、Hub は中継しない。
 *    支払いの後、この端末に残る注文の札で Commerce から所有の証明を受け取り、証明だけを Hub へ渡す。
 *    Hub はサーバーで証明を確かめてからライブラリに入れる（注文ID・札は Hub に送らない）。
 *  - 起動は Hub Desktop の「このPCで起動」から人が押す（docs/hub-software/DRM.md の境界のまま）。
 *  - 年齢（PLAN.md §9 Q5）: 有料の作品と18歳区分の作品は「18歳以上です」の申告が要る。申告は Hub に
 *    「申告した」ことだけを残す。Hub のサーバーも同じ条件で断る（所有の記録・ダウンロードの札）。
 *  - 持っている人には版の一覧と「ダウンロード」。押すと Hub が所有と年齢を確かめ、ファイル部品宛ての
 *    一回きりの札を出す。ブラウザは札付きの URL をファイル部品から直接落とす（Hub は中身を通さない）。
 */

export type V2GameBuyBoxProps = {
  gameId: string;
  title: string;
  storeListing: "free" | "paid";
  commerceProductId: string | null;
  signedIn: boolean;
  slug: string;
  ageRating?: "all" | "12" | "15" | "18";
};

type Build = { id: string; version: string; platform: "windows" | "macos" | "linux"; kind: "full" | "demo"; channel: "stable" | "beta"; sha256: string; sizeBytes: number };
const PLATFORM_LABEL: Record<Build["platform"], string> = { windows: "Windows", macos: "macOS", linux: "Linux" };
const AGE_LABEL: Record<"12" | "15" | "18", string> = { "12": "12歳以上", "15": "15歳以上", "18": "18歳以上" };

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Ownership = { owned: boolean; source: "free" | "commerce" | null };
const CLAIM_ATTEMPTS = 10;

async function hubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "hub_unavailable");
  return body;
}

export function V2GameBuyBox({ gameId, title, storeListing, commerceProductId, signedIn, slug, ageRating = "all" }: V2GameBuyBoxProps) {
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const needsAdult = storeListing === "paid" || ageRating === "18";
  const [adult, setAdult] = useState<boolean | null>(needsAdult ? null : true);
  const [adultChecked, setAdultChecked] = useState(false);
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [productState, setProductState] = useState<"idle" | "loading" | "ready" | "error">(storeListing === "paid" ? "loading" : "idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const autoClaimed = useRef(false);
  const ownershipPath = `/api/games/${encodeURIComponent(gameId)}/library`;

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    hubJson<Ownership>(ownershipPath).then((value) => { if (live) setOwnership(value); }).catch(() => { if (live) setOwnership(null); });
    return () => { live = false; };
  }, [ownershipPath, signedIn]);

  useEffect(() => {
    if (!signedIn || !needsAdult) return;
    let live = true;
    hubJson<{ declared: boolean }>("/api/games/age-declaration")
      .then((value) => { if (live) setAdult(value.declared === true); })
      .catch(() => { if (live) setAdult(null); });
    return () => { live = false; };
  }, [needsAdult, signedIn]);

  const ownedNow = ownership?.owned === true;
  useEffect(() => {
    if (!ownedNow) return;
    let live = true;
    hubJson<{ builds: Build[] }>(`/api/games/${encodeURIComponent(gameId)}/builds`)
      .then((value) => { if (live) setBuilds(Array.isArray(value.builds) ? value.builds : []); })
      .catch(() => { if (live) setBuilds([]); });
    return () => { live = false; };
  }, [gameId, ownedNow]);

  useEffect(() => {
    if (storeListing !== "paid" || !commerceProductId) return;
    const controller = new AbortController();
    setProductState("loading");
    commerceRequest<Record<string, unknown>>(`/products/${encodeURIComponent(commerceProductId)}`, { signal: controller.signal, credentials: "omit", redirect: "error" })
      .then((body) => {
        const next = readPublicProduct(body.product, commerceProductId);
        if (next.fulfillmentType !== "digital") throw new Error("not_digital");
        setProduct(next);
        setProductState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setProductState("error"); });
    return () => controller.abort();
  }, [commerceProductId, storeListing]);

  /* 支払い済みの注文を、この端末の注文の札で Commerce に確かめ、証明だけを Hub に渡す。 */
  const claim = useCallback(async (quiet: boolean) => {
    if (!commerceProductId) return;
    const orders = readWalletOrderSession().slice(0, CLAIM_ATTEMPTS);
    if (!orders.length) {
      if (!quiet) setMessage("この端末に支払いの記録がありません。支払った端末とブラウザで開いてください。");
      return;
    }
    setBusy(true);
    if (!quiet) setMessage("支払いを確認しています。");
    try {
      for (const order of orders) {
        const response = await fetch(commerceApiUrl(`/orders/${encodeURIComponent(order.orderId)}/game-entitlement`), {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          headers: { "content-type": "application/json", authorization: `Bearer ${order.accessToken}` },
          body: JSON.stringify({ productId: commerceProductId }),
        }).catch(() => null);
        if (!response?.ok) continue;
        const body = await response.json().catch(() => null) as { proof?: unknown } | null;
        if (typeof body?.proof !== "string") continue;
        const result = await hubJson<Ownership & { status: "granted" | "revoked" }>(`/api/games/${encodeURIComponent(gameId)}/entitlements`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proof: body.proof }),
        }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "hub_unavailable" }));
        if ("error" in result) {
          if (result.error === "entitlement_already_claimed") { setMessage("この支払いは別のアカウントのライブラリに入っています。"); return; }
          continue;
        }
        setOwnership({ owned: result.owned, source: result.source });
        if (result.owned) { setMessage("購入を確認しました。ライブラリに入りました。"); return; }
      }
      if (!quiet) setMessage("この作品の支払い済みの注文が見つかりませんでした。支払いが確定するまで数分かかることがあります。");
    } finally {
      setBusy(false);
    }
  }, [commerceProductId, gameId]);

  useEffect(() => {
    if (autoClaimed.current || !signedIn || storeListing !== "paid" || !ownership || ownership.owned || adult !== true) return;
    autoClaimed.current = true;
    void claim(true);
  }, [adult, claim, ownership, signedIn, storeListing]);

  async function declare() {
    if (!adultChecked) return;
    setBusy(true);
    setMessage("");
    try {
      await hubJson("/api/games/age-declaration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ declaredAdult: true }),
      });
      setAdult(true);
    } catch {
      setMessage("申告を記録できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function download(build: Build) {
    setBusy(true);
    setMessage("");
    try {
      const ticket = await hubJson<{ url: string; sha256: string }>(
        `/api/games/${encodeURIComponent(gameId)}/builds/${encodeURIComponent(build.id)}/download`,
        { method: "POST" },
      );
      // 同じ origin のファイル部品（/vault/api/files/…）だけを開く。札は一回きりで2分で切れる。
      if (typeof ticket.url !== "string" || !ticket.url.startsWith("/vault/api/files/")) throw new Error("bad_ticket");
      window.location.assign(ticket.url);
      setMessage("ダウンロードを始めました。落とした後、SHA-256 が上の値と同じか確かめてください。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "age_declaration_required" ? "18歳以上の申告が必要です。"
        : code === "not_owned" ? "この作品はライブラリにありません。"
          : "ダウンロードを準備できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function addFree() {
    setBusy(true);
    setMessage("");
    try {
      setOwnership(await hubJson<Ownership>(ownershipPath, { method: "POST" }));
      setMessage("ライブラリに追加しました。");
    } catch {
      setMessage("ライブラリに追加できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const loginHref = `/v2/auth?next=${encodeURIComponent(`/v2/games/${slug}`)}`;
  const owned = ownership?.owned === true;
  const price = product ? productPriceLabels(product) : null;

  return (
    <div className="v2-gstore__buy" aria-label="入手">
      <p className="v2-gstore__buy-title">{title}</p>
      {ageRating !== "all" ? <p className="v2-gstore__age">{AGE_LABEL[ageRating]}</p> : null}
      {storeListing === "free" ? (
        <p className="v2-gstore__price"><strong>無料</strong></p>
      ) : productState === "ready" && price ? (
        <p className="v2-gstore__price">
          <strong>{price.main}</strong>{price.mainSuffix ? <span>{price.mainSuffix}</span> : null}
          <small>{price.note}</small>
        </p>
      ) : productState === "error" ? (
        <p className="v2-gstore__buy-note" role="status">価格を読み込めませんでした。</p>
      ) : (
        <p className="v2-gstore__buy-note" role="status">価格を読み込んでいます</p>
      )}
      {owned ? (
        <>
          <p className="v2-gstore__owned" role="status">ライブラリにあります</p>
          <Link className="v2-gstore__action" href="/v2/games/library">ライブラリを開く</Link>
          <p className="v2-gstore__buy-note">Hub Desktop では、ツールバーの「このPCで起動」から起動します。</p>
          {needsAdult && adult !== true ? null : builds && builds.length ? (
            <ul className="v2-gstore__builds" aria-label="ダウンロード">
              {builds.map((build) => (
                <li key={build.id} className="v2-gstore__build">
                  <span className="v2-gstore__build-name">
                    {build.version}・{PLATFORM_LABEL[build.platform]}{build.kind === "demo" ? "・体験版" : ""}{build.channel === "beta" ? "・試験版" : ""}・{formatBytes(build.sizeBytes)}
                  </span>
                  <code className="v2-gstore__build-hash" title="SHA-256">{build.sha256}</code>
                  <button type="button" className="v2-gstore__action v2-gstore__action--quiet" onClick={() => void download(build)} disabled={busy}>ダウンロード</button>
                </li>
              ))}
            </ul>
          ) : builds ? <p className="v2-gstore__buy-note">ダウンロードできる版はまだありません。</p> : null}
        </>
      ) : !signedIn ? (
        <Link className="v2-gstore__action" href={loginHref}>{storeListing === "free" ? "ログインしてライブラリに追加" : "ログインして購入"}</Link>
      ) : needsAdult && adult === false ? (
        <div className="v2-gstore__age-check">
          <p className="v2-gstore__buy-note">
            {storeListing === "paid" ? "購入できるのは18歳以上の方だけです。" : "この作品は18歳以上の方だけが入れられます。"}
            16・17歳の方は、18歳区分でない無料の作品を入れられます。
          </p>
          <label className="v2-gstore__age-label">
            <input type="checkbox" checked={adultChecked} onChange={(event) => setAdultChecked(event.target.checked)} disabled={busy} />
            <span>18歳以上です</span>
          </label>
          <button type="button" className="v2-gstore__action" onClick={() => void declare()} disabled={busy || !adultChecked}>申告して進む</button>
        </div>
      ) : storeListing === "free" ? (
        <button type="button" className="v2-gstore__action" onClick={addFree} disabled={busy || !ownership}>ライブラリに追加</button>
      ) : (
        <>
          {/* 申告を確かめるまで「購入」は出さない（Hub のサーバーも申告なしの所有を断る）。 */}
          {productState === "ready" && commerceProductId && adult === true ? (
            <Link className="v2-gstore__action" href={`/v2/market/digital?product=${encodeURIComponent(commerceProductId)}`}>購入</Link>
          ) : null}
          <button type="button" className="v2-gstore__action v2-gstore__action--quiet" onClick={() => void claim(false)} disabled={busy || !ownership}>購入済みか確認する</button>
          <p className="v2-gstore__buy-note">支払いと注文は Commerce が扱います。Hub は確認の証明だけを受け取ります。</p>
          {product ? (
            <a className="v2-gstore__legal" href={product.seller.legalDisplayUrl} target="_blank" rel="noopener noreferrer">販売者 {product.seller.publicName}・販売条件 ↗</a>
          ) : null}
        </>
      )}
      {message ? <p className="v2-gstore__buy-note" role="status">{message}</p> : null}
    </div>
  );
}
