"use client";

import { useEffect, useState, type FormEvent } from "react";

const COMMERCE = "/shopping/api/commerce/api/v1";
type Chain = {
  key: string;
  family: string;
  label: string;
  nativeSymbol: string;
  referenceMode: string;
  rpcConfigured: boolean;
  registrationAvailable: boolean;
  verificationAvailable: boolean;
  paymentAvailable: boolean;
  merchantFeeAvailable: boolean;
  merchantFeeReason: string | null;
};
type Destination = {
  networkKey: string;
  address: string;
  addressTag: string | null;
  status: "active" | "disabled";
  updatedAt: string;
};

export function MerchantChainDestinations() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [catalogResponse, destinationResponse] = await Promise.all([
      fetch(`${COMMERCE}/payment/chain-catalog`, { cache: "no-store" }),
      fetch(`${COMMERCE}/seller/chain-destinations`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (!catalogResponse.ok || !destinationResponse.ok)
      throw new Error("chain_destinations_unavailable");
    setChains(((await catalogResponse.json()) as { chains: Chain[] }).chains);
    setDestinations(
      ((await destinationResponse.json()) as { destinations: Destination[] })
        .destinations,
    );
  }

  useEffect(() => {
    void load().catch(() =>
      setMessage("チェーン別の受取先を取得できませんでした。"),
    );
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, chain: Chain) {
    event.preventDefault();
    setBusy(chain.key);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${COMMERCE}/seller/chain-destinations`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        networkKey: chain.key,
        address: String(form.get("address") ?? "").trim(),
        addressTag: String(form.get("addressTag") ?? "").trim() || null,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok)
      setMessage(body?.error ?? "受取先を保存できませんでした。");
    else {
      setMessage(`${chain.label}の受取先を保存しました。`);
      await load();
    }
    setBusy(null);
  }

  async function disable(chain: Chain) {
    setBusy(chain.key);
    setMessage("");
    const response = await fetch(
      `${COMMERCE}/seller/chain-destinations/${encodeURIComponent(chain.key)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) setMessage("受取先を無効化できませんでした。");
    else {
      setMessage(`${chain.label}の受取を停止しました。`);
      await load();
    }
    setBusy(null);
  }

  return (
    <section className="commerce-product-form">
      <div className="commerce-form-heading">
        <div>
          <h2>チェーン別の受取先</h2>
        </div>
        <span>秘密鍵は登録しません</span>
      </div>
      <p>
        「登録」「入金検証」「購入」「店舗手数料負担」は別々の対応段階です。購入不可のチェーンを、利用可能とは表示しません。
      </p>
      {message ? <p role="status">{message}</p> : null}
      {chains.map((chain) => {
        const current = destinations.find(
          (item) => item.networkKey === chain.key,
        );
        const tagRequired =
          chain.referenceMode === "memo" ||
          chain.referenceMode === "destination_tag";
        return (
          <form key={chain.key} onSubmit={(event) => void save(event, chain)}>
            <h3>
              {chain.label} · {chain.nativeSymbol}
            </h3>
            <p>
              登録：{chain.registrationAvailable ? "可" : "不可"} · 入金検証：
              {chain.verificationAvailable ? "可" : "不可"} · 購入：
              {chain.paymentAvailable ? "可" : "不可"} · ネットワーク手数料：
              {chain.merchantFeeAvailable ? "店舗負担可" : "購入者負担"}
            </p>
            <label>
              受取アドレス
              <input
                name="address"
                required
                defaultValue={current?.address ?? ""}
                autoComplete="off"
              />
            </label>
            {tagRequired ? (
              <label>
                {chain.referenceMode === "destination_tag"
                  ? "Destination Tag"
                  : "Memo"}
                <input
                  name="addressTag"
                  defaultValue={current?.addressTag ?? ""}
                  autoComplete="off"
                />
              </label>
            ) : null}
            <div className="commerce-list-actions">
              <button type="submit" disabled={busy === chain.key}>
                {busy === chain.key ? "保存中…" : "保存"}
              </button>
              {current?.status === "active" ? (
                <button
                  type="button"
                  disabled={busy === chain.key}
                  onClick={() => void disable(chain)}
                >
                  受取停止
                </button>
              ) : null}
            </div>
          </form>
        );
      })}
    </section>
  );
}
