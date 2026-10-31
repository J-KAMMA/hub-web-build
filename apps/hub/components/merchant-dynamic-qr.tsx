"use client";

import QRCode from "qrcode";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

declare global {
  interface Window {
    NDEFReader?: new () => {
      write(message: {
        records: Array<{ recordType: "url"; data: string }>;
      }): Promise<void>;
    };
  }
}

type Product = {
  id: string;
  title: string;
  priceJpyc: number;
  fulfillmentType: string;
  status: string;
};
type Asset = {
  currency: "JPYC" | "USDC";
  chainId: number;
  chainName: string;
  tokenContract: string;
  decimals: number;
};
type PaidOrder = {
  id: string;
  productTitle: string;
  quantity: number;
  amountJpyc: number;
  fulfillmentType: string;
  paidAt: string | null;
};
type MerchantWallet = {
  walletAddress: string;
  chainId: number;
  status: string;
};
const BARCODE_STORAGE_KEY = "hub.commerce.pos.barcodes.v1";
const CART_STORAGE_KEY = "hub.commerce.pos.cart.v1";
const VALID_BARCODE = /^[0-9A-Za-z._-]{4,64}$/;

export function MerchantDynamicQr({ products }: { products: Product[] }) {
  const eligible = products.filter(
    (product) =>
      product.status === "active" && product.fulfillmentType === "pickup",
  );
  const [productId, setProductId] = useState(eligible[0]?.id ?? "");
  const [cart, setCart] = useState<Record<string, number>>(() =>
    eligible[0] ? { [eligible[0].id]: 1 } : {},
  );
  const [country, setCountry] = useState("JP");
  const [discountBps, setDiscountBps] = useState(0);
  const [image, setImage] = useState("");
  const [url, setUrl] = useState("");
  const [requestId, setRequestId] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [paidOrder, setPaidOrder] = useState<PaidOrder | null>(null);
  const [registerMode, setRegisterMode] = useState(false);
  const [online, setOnline] = useState(true);
  const [nfcStatus, setNfcStatus] = useState("");
  const [nfcBusy, setNfcBusy] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [barcodeStatus, setBarcodeStatus] = useState("");
  const [barcodeMap, setBarcodeMap] = useState<Record<string, string>>({});
  const sectionRef = useRef<HTMLElement>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [countries, setCountries] = useState<string[]>(["JP"]);
  const [assetKey, setAssetKey] = useState("");
  const [merchantWallet, setMerchantWallet] =
    useState<MerchantWallet | null>(null);
  useEffect(() => {
    const loadConnection = async () => {
      try {
        const [assetsResponse, walletResponse, countriesResponse] = await Promise.all([
          fetch("/shopping/api/commerce/api/v1/payment/assets", {
            cache: "no-store",
          }),
          fetch("/shopping/api/commerce/api/v1/seller/wallet", {
            credentials: "include",
            cache: "no-store",
          }),
          fetch("/shopping/api/commerce/api/v1/payment/jurisdictions", {
            cache: "no-store",
          }),
        ]);
        if (!assetsResponse.ok || !walletResponse.ok || !countriesResponse.ok) throw new Error();
        const [assetsBody, walletBody, countriesBody] = (await Promise.all([
          assetsResponse.json(),
          walletResponse.json(),
          countriesResponse.json(),
        ])) as [{ assets: Asset[] }, { wallet: MerchantWallet | null }, { countries: string[] }];
        const wallet = walletBody.wallet;
        const compatible = wallet
          ? assetsBody.assets.filter(
              (item) =>
                item.chainId === wallet.chainId &&
                (item.currency === "JPYC" || item.currency === "USDC"),
            )
          : [];
        setMerchantWallet(wallet);
        setCountries(countriesBody.countries);
        setAssets(compatible);
        setAssetKey(
          compatible[0]
            ? `${compatible[0].currency}:${compatible[0].chainId}`
            : "",
        );
      } catch {
        setMerchantWallet(null);
        setAssets([]);
        setAssetKey("");
      }
    };
    void loadConnection();
    window.addEventListener("hub-merchant-wallet-updated", loadConnection);
    return () =>
      window.removeEventListener(
        "hub-merchant-wallet-updated",
        loadConnection,
      );
  }, []);
  const asset = assets.find(
    (item) => `${item.currency}:${item.chainId}` === assetKey,
  );
  const selected = eligible.find((product) => product.id === productId);
  const lines = useMemo(
    () =>
      eligible
        .filter((product) => cart[product.id])
        .map((product) => ({ product, quantity: cart[product.id] })),
    [cart, eligible],
  );
  const subtotal = lines.reduce(
    (sum, line) => sum + line.product.priceJpyc * line.quantity,
    0,
  );
  const discount = Math.floor((subtotal * discountBps) / 10_000);

  useEffect(() => {
    let active = true;
    if (!url) {
      setImage("");
      return;
    }
    void QRCode.toDataURL(url, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((value) => {
        if (active) {
          setImage(value);
          setExpiresAt(Number(new URL(url).searchParams.get("expiresAt")));
          setGeneratedAt(Date.now());
          setPaidOrder(null);
        }
      })
      .catch(() => {
        if (active) setImage("");
      });
    return () => {
      active = false;
    };
  }, [url]);

  useEffect(() => {
    if (!requestId) return;
    const source = new EventSource(
      `/shopping/api/commerce/api/v1/seller/order-events?requestId=${encodeURIComponent(requestId)}`,
      { withCredentials: true },
    );
    source.addEventListener("order", (event) => {
      try {
        const body = JSON.parse((event as MessageEvent<string>).data) as {
          order?: {
            id: string;
            status: string;
            amountJpyc: number;
            paidAt: string | null;
          } | null;
        };
        if (body.order?.status === "paid" || body.order?.status === "refunded")
          setPaidOrder({
            id: body.order.id,
            productTitle: lines.map((line) => line.product.title).join("・"),
            quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
            amountJpyc: body.order.amountJpyc,
            fulfillmentType: "pickup",
            paidAt: body.order.paidAt,
          });
      } catch {
        /* invalid events fail closed */
      }
    });
    return () => source.close();
  }, [lines, requestId]);

  useEffect(() => {
    const sync = () =>
      setRegisterMode(document.fullscreenElement === sectionRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(BARCODE_STORAGE_KEY) ?? "{}",
      );
      if (value && typeof value === "object")
        setBarcodeMap(value as Record<string, string>);
    } catch {
      setBarcodeMap({});
    }
  }, []);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(CART_STORAGE_KEY) ?? "{}",
      ) as Record<string, unknown>;
      const restored = Object.fromEntries(
        Object.entries(value).filter(
          ([id, quantity]) =>
            eligible.some((product) => product.id === id) &&
            Number.isInteger(quantity) &&
            Number(quantity) > 0 &&
            Number(quantity) <= 999,
        ),
      );
      if (Object.keys(restored).length)
        setCart(restored as Record<string, number>);
    } catch {
      /* keep the safe initial cart */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  async function startRegister() {
    setRegisterMode(true);
    try {
      await sectionRef.current?.requestFullscreen();
    } catch {
      /* CSS register mode remains available */
    }
    try {
      const nav = navigator as Navigator & {
        wakeLock?: {
          request(type: "screen"): Promise<{ release(): Promise<void> }>;
        };
      };
      wakeLockRef.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  }
  async function stopRegister() {
    setRegisterMode(false);
    if (document.fullscreenElement)
      await document.exitFullscreen().catch(() => undefined);
    await wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }
  function nextSale() {
    setPaidOrder(null);
    setUrl("");
    setImage("");
    setRequestId("");
  }
  function saveBarcode() {
    const code = barcode.trim();
    if (!VALID_BARCODE.test(code) || !selected) {
      setBarcodeStatus("4〜64文字のバーコードを読み取ってください。");
      return;
    }
    const next = { ...barcodeMap, [code]: selected.id };
    setBarcodeMap(next);
    localStorage.setItem(BARCODE_STORAGE_KEY, JSON.stringify(next));
    setBarcodeStatus(`${selected.title}に登録しました。`);
    setBarcode("");
  }
  function acceptBarcode() {
    const code = barcode.trim();
    if (!VALID_BARCODE.test(code)) {
      setBarcodeStatus("バーコードを認識できませんでした。");
      return;
    }
    const found = eligible.find((product) => product.id === barcodeMap[code]);
    if (!found) {
      setBarcodeStatus(
        "未登録のバーコードです。商品を選び「選択商品に登録」を押してください。",
      );
      return;
    }
    setProductId(found.id);
    setCart((current) => ({
      ...current,
      [found.id]: Math.min(999, (current[found.id] ?? 0) + 1),
    }));
    setPaidOrder(null);
    setBarcodeStatus(`${found.title}を追加しました。`);
    setBarcode("");
  }
  function barcodeKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      acceptBarcode();
    }
  }
  async function writeNfc() {
    if (!url || !window.NDEFReader) {
      setNfcStatus(
        "この端末ではNFC書き込みを利用できません。QRをご利用ください。",
      );
      return;
    }
    setNfcBusy(true);
    setNfcStatus("NFCタグを端末へ近づけてください…");
    try {
      const reader = new window.NDEFReader();
      await reader.write({ records: [{ recordType: "url", data: url }] });
      setNfcStatus(
        "書き込みました。お客様がタグへスマホを当てると支払い画面が開きます。",
      );
    } catch {
      setNfcStatus(
        "NFCへ書き込めませんでした。端末のNFC設定と権限を確認してください。",
      );
    } finally {
      setNfcBusy(false);
    }
  }
  async function generatePaymentRequest() {
    if (!asset || !merchantWallet || !lines.length) return;
    setBarcodeStatus("署名付き請求を作成しています…");
    try {
      const response = await fetch(
        "/shopping/api/commerce/api/v1/seller/payment-requests",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: lines.map((line) => ({
              productId: line.product.id,
              quantity: line.quantity,
            })),
            billingCountry: country,
            currency: asset.currency,
            chainId: asset.chainId,
            discountBps,
          }),
        },
      );
      const body = (await response.json()) as {
        paymentRequest?: {
          token: string;
          requestId: string;
          expiresAt: number;
        };
        error?: string;
      };
      if (!response.ok || !body.paymentRequest)
        throw new Error(body.error ?? "請求を作成できませんでした。");
      setUrl(
        `${window.location.origin}/wallet/pay?request=${encodeURIComponent(body.paymentRequest.token)}`,
      );
      setRequestId(body.paymentRequest.requestId);
      setBarcodeStatus("改ざん検知付きの請求を作成しました。");
    } catch (error) {
      setBarcodeStatus(
        error instanceof Error ? error.message : "請求を作成できませんでした。",
      );
    }
  }

  if (!eligible.length)
    return (
      <section id="pos" className="commerce-pos">
        <h2>店頭QR決済</h2>
        <p>店頭受取の商品を公開すると動的QRを作成できます。</p>
      </section>
    );
  return (
    <section
      id="pos"
      ref={sectionRef}
      className={`commerce-pos${registerMode ? " commerce-pos--register" : ""}`}
      aria-labelledby="commerce-pos-title"
    >
      <header className="commerce-pos-header">
        <div>
          <small>POINT OF SALE</small>
          <h2 id="commerce-pos-title">店頭向け動的請求QR</h2>
          <p>会計ごとに商品・数量・課税国を固定したQRを生成します。</p>
        </div>
        <button
          type="button"
          onClick={() => void (registerMode ? stopRegister() : startRegister())}
        >
          {registerMode ? "レジモードを終了" : "レジモードを開始"}
        </button>
      </header>
      {merchantWallet ? (
        <p className="commerce-pos-nfc-status" role="status">
          受取先：店舗ウォレット{" "}
          <code>
            {merchantWallet.walletAddress.slice(0, 8)}…
            {merchantWallet.walletAddress.slice(-6)}
          </code>{" "}
          · Chain {merchantWallet.chainId}
        </p>
      ) : (
        <p className="commerce-pos-nfc-status" role="alert">
          店舗ウォレットが未接続です。{" "}
          <a href="#merchant-settings">店舗ウォレットを登録</a>
          するとレジQRを発行できます。
        </p>
      )}
      {merchantWallet && !assets.length ? (
        <p className="commerce-pos-nfc-status" role="alert">
          店舗ウォレットのチェーンで利用できる決済通貨がありません。
        </p>
      ) : null}
      {!online ? (
        <p className="commerce-pos-nfc-status" role="status">
          オフラインです。カートは端末に保持しますが、支払い完了にはしません。接続が戻ってから署名付きQRを生成してください。
        </p>
      ) : null}
      <div className="commerce-pos-grid">
        <div className="commerce-pos-fields">
          <div className="commerce-pos-barcode">
            <label>
              商品バーコード
              <input
                value={barcode}
                autoFocus
                autoComplete="off"
                inputMode="text"
                placeholder="バーコードを読み取る"
                onChange={(event) => setBarcode(event.target.value)}
                onKeyDown={barcodeKey}
              />
            </label>
            <div>
              <button type="button" onClick={acceptBarcode}>
                商品を追加
              </button>
              <button type="button" onClick={saveBarcode}>
                選択商品に登録
              </button>
            </div>
            {barcodeStatus ? <p role="status">{barcodeStatus}</p> : null}
          </div>
          <label>
            商品
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              {eligible.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} — {product.priceJpyc.toLocaleString()} JPYC
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              selected &&
              setCart((current) => ({
                ...current,
                [selected.id]: Math.min(999, (current[selected.id] ?? 0) + 1),
              }))
            }
          >
            選択商品をカートへ追加
          </button>
          <div className="commerce-pos-cart">
            <strong>
              カート {lines.length}種類・
              {lines.reduce((sum, line) => sum + line.quantity, 0)}点
            </strong>
            {lines.map((line) => (
              <article key={line.product.id}>
                <span>{line.product.title}</span>
                <input
                  aria-label={`${line.product.title}の数量`}
                  type="number"
                  min="1"
                  max="999"
                  value={line.quantity}
                  onChange={(event) =>
                    setCart((current) => ({
                      ...current,
                      [line.product.id]: Math.max(
                        1,
                        Math.min(999, Number(event.target.value) || 1),
                      ),
                    }))
                  }
                />
                <b>
                  {(line.product.priceJpyc * line.quantity).toLocaleString()}{" "}
                  JPYC
                </b>
                <button
                  type="button"
                  onClick={() =>
                    setCart((current) => {
                      const next = { ...current };
                      delete next[line.product.id];
                      return next;
                    })
                  }
                >
                  削除
                </button>
              </article>
            ))}
          </div>
          <label>
            課税国
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              {countries.map((countryCode) => (
                <option key={countryCode} value={countryCode}>
                  {countryCode}
                </option>
              ))}
            </select>
          </label>
          <label>
            通貨・チェーン
            <select
              value={assetKey}
              onChange={(event) => setAssetKey(event.target.value)}
            >
              {assets.map((item) => (
                <option
                  key={`${item.currency}:${item.chainId}`}
                  value={`${item.currency}:${item.chainId}`}
                >
                  {item.currency} — {item.chainName}
                </option>
              ))}
            </select>
          </label>
          <label>
            割引率
            <select
              value={discountBps}
              onChange={(event) => setDiscountBps(Number(event.target.value))}
            >
              <option value="0">割引なし</option>
              <option value="500">5%</option>
              <option value="1000">10%</option>
              <option value="2000">20%</option>
            </select>
          </label>
          <strong>
            税別小計 {subtotal.toLocaleString()} − 割引{" "}
            {discount.toLocaleString()} ={" "}
            {(subtotal - discount).toLocaleString()} {asset?.currency ?? ""}
          </strong>
          <p>
            税額と税込合計は購入者の接続情報を照合した後、署名前に表示されます。
          </p>
          <button
            type="button"
            aria-disabled={
              !lines.length || !online || !merchantWallet || !asset
            }
            disabled={
              !lines.length || !online || !merchantWallet || !asset
            }
            onClick={() => void generatePaymentRequest()}
          >
            署名付きQRを生成
          </button>
          <button
            type="button"
            disabled={nfcBusy || !url}
            onClick={() => void writeNfc()}
          >
            {nfcBusy ? "NFC書き込み中…" : "NFCタグへ書き込む"}
          </button>
          {nfcStatus ? (
            <p className="commerce-pos-nfc-status" role="status">
              {nfcStatus}
            </p>
          ) : null}
        </div>
        <div className="commerce-pos-qr">
          {paidOrder ? (
            <div
              className="commerce-pos-paid"
              role="status"
              aria-live="assertive"
            >
              <span>✓</span>
              <strong>支払いを確認しました</strong>
              <b>{paidOrder.amountJpyc.toLocaleString()} JPYC</b>
              <small>注文 {paidOrder.id.slice(0, 8)}</small>
              <button type="button" onClick={nextSale}>
                次の会計
              </button>
            </div>
          ) : (
            <>
              {image ? (
                <img src={image} alt="店頭支払い用の動的QRコード" />
              ) : (
                <span>QRを生成できません</span>
              )}
              <strong>
                スマホをNFCタグへタッチ、またはQRを読み取ってください
              </strong>
              <small>
                {expiresAt
                  ? `表示期限 ${new Date(expiresAt).toLocaleTimeString("ja-JP")}`
                  : ""}
              </small>
              <small>支払い確認を自動監視中</small>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
