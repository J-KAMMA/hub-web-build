"use client";
import { useEffect, useState } from "react";
type Acquisition = {
  orderId: string;
  assetSymbol: string;
  quantityAtomic: string;
  baseCurrency: string;
  rateMicros: string;
  rateSource: string;
  rateObservedAt: string;
  acquisitionBaseAmountMinor: string;
  transactionHash: string;
  acquiredAt: string;
};
const API = "/shopping/api/commerce/api/v1/seller/tax/asset-ledger";
export function MerchantAssetTaxLedger() {
  const year = new Date().getFullYear(),
    [items, setItems] = useState<Acquisition[]>([]);
  useEffect(() => {
    void fetch(`${API}?year=${year}`, {
      credentials: "include",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) return;
      const body = (await response.json()) as { acquisitions: Acquisition[] };
      setItems(body.acquisitions);
    });
  }, [year]);
  const total = items.reduce(
    (sum, item) => sum + BigInt(item.acquisitionBaseAmountMinor),
    0n,
  );
  return (
    <section className="commerce-asset-tax-ledger">
      <header>
        <div>
            <h2>受取資産の基準通貨台帳</h2>
          <p>
            決済確定時の円換算額とレート証拠です。売上請求書とは分離して記録されます。
          </p>
        </div>
        <a href={`${API}.csv?year=${year}`}>CSVをダウンロード</a>
      </header>
      <dl>
        <div>
          <dt>{year}年の取得価額合計</dt>
          <dd>{total.toLocaleString()}円</dd>
        </div>
        <div>
          <dt>受取件数</dt>
          <dd>{items.length}件</dd>
        </div>
      </dl>
      {items.length ? (
        <div className="commerce-asset-tax-list">
          {items.slice(0, 20).map((item) => (
            <article key={item.orderId}>
              <b>
                {item.assetSymbol}・{item.acquisitionBaseAmountMinor}円
              </b>
              <span>数量（最小単位） {item.quantityAtomic}</span>
              <span>
                レート {item.rateMicros} micros/{item.assetSymbol}・
                {item.rateSource}
              </span>
              <time>{new Date(item.acquiredAt).toLocaleString("ja-JP")}</time>
            </article>
          ))}
        </div>
      ) : (
        <p>確定済みの通貨受取はまだありません。</p>
      )}
    </section>
  );
}
