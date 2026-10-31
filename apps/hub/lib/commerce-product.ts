/*
 * Commerce の公開商品（GET /api/v1/products, /products/:id）の形と検証。
 * 2026-10-18（所有者承認）：画面には税込の総額を大きく、本体価格（税別）を小さく出す。
 * 税込額は Commerce が注文と同じ規則・丸めで計算して taxIncluded に入れる。Hub は計算し直さない。
 */

export type ProductTaxIncluded =
  | {
      status: "determined";
      country: string;
      rateBps: number;
      category: string;
      ruleVersion: string;
      supplyDate: string;
      priceJpyc: number;
      taxJpyc: number;
      shippingJpyc: number | null;
      totalForOneJpyc: number;
    }
  | { status: "unavailable"; reason: string };

export type Product = {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  priceJpyc: number;
  shippingJpyc: number | null;
  stockQuantity: number | null;
  fulfillmentType: string;
  gasPayerPolicy: "merchant" | "buyer" | "merchant_above_threshold";
  gasSponsorThresholdJpy: number | null;
  /** 古い Commerce は返さない。無いときは税込額を出さず「税は注文時に確定」と書く。 */
  taxIncluded?: ProductTaxIncluded;
  seller: { id: string; publicName: string; legalDisplayUrl: string };
};

export const PRODUCT_SORTS = [
  { value: "new", label: "新着" },
  { value: "price_asc", label: "価格の安い順" },
  { value: "price_desc", label: "価格の高い順" },
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number]["value"];

export const publicId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$(?![\s\S])/.test(value);
export const publicMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const publicText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max && !/[\p{Cc}\p{Surrogate}]/u.test(value);
const publicDescription = (value: unknown) =>
  typeof value === "string" &&
  value.length <= 10000 &&
  !/[\p{Cc}\p{Surrogate}]/u.test(value.replace(/[\r\n\t]/g, ""));
export function publicUrl(value: unknown) {
  if (!publicText(value, 2048) || !value || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

function readTaxIncluded(value: unknown, product: Product): ProductTaxIncluded {
  const tax = value as ProductTaxIncluded | null;
  if (!tax || typeof tax !== "object" || Array.isArray(tax)) throw Error("invalid_public_product");
  if (tax.status === "unavailable") {
    if (!publicText(tax.reason, 120)) throw Error("invalid_public_product");
    return { status: "unavailable", reason: tax.reason };
  }
  if (
    tax.status !== "determined" ||
    !publicText(tax.country, 2) ||
    !publicMoney(tax.rateBps) ||
    tax.rateBps > 10000 ||
    !publicText(tax.category, 64) ||
    !publicText(tax.ruleVersion, 200) ||
    !publicText(tax.supplyDate, 10) ||
    !publicMoney(tax.priceJpyc) ||
    !publicMoney(tax.taxJpyc) ||
    tax.priceJpyc !== product.priceJpyc + tax.taxJpyc ||
    !(tax.shippingJpyc === null || publicMoney(tax.shippingJpyc)) ||
    !publicMoney(tax.totalForOneJpyc) ||
    tax.totalForOneJpyc < tax.priceJpyc
  )
    throw Error("invalid_public_product");
  return {
    status: "determined",
    country: tax.country,
    rateBps: tax.rateBps,
    category: tax.category,
    ruleVersion: tax.ruleVersion,
    supplyDate: tax.supplyDate,
    priceJpyc: tax.priceJpyc,
    taxJpyc: tax.taxJpyc,
    shippingJpyc: tax.shippingJpyc,
    totalForOneJpyc: tax.totalForOneJpyc,
  };
}

export function readPublicProduct(value: unknown, expected?: string): Product {
  const product = value as Product | null;
  if (
    !product ||
    typeof product !== "object" ||
    Array.isArray(product) ||
    !publicId(product.id) ||
    (expected !== undefined && product.id !== expected) ||
    !publicText(product.title, 240) ||
    !product.title.trim() ||
    !publicDescription(product.description) ||
    !(product.imageUrl === null || publicUrl(product.imageUrl)) ||
    !publicMoney(product.priceJpyc) ||
    !(product.shippingJpyc === null || publicMoney(product.shippingJpyc)) ||
    !(product.stockQuantity === null || publicMoney(product.stockQuantity)) ||
    !["digital", "pickup", "seller_shipping", "platform_3pl"].includes(product.fulfillmentType) ||
    !product.seller ||
    !publicId(product.seller.id) ||
    !publicText(product.seller.publicName, 200) ||
    !product.seller.publicName.trim() ||
    !publicUrl(product.seller.legalDisplayUrl)
  )
    throw Error("invalid_public_product");
  if (product.taxIncluded !== undefined)
    return { ...product, taxIncluded: readTaxIncluded(product.taxIncluded, product) };
  return product;
}

export const availablePhysicalProduct = (product: Product) =>
  ["seller_shipping", "platform_3pl"].includes(product.fulfillmentType) &&
  (product.stockQuantity ?? 0) > 0;

const yen = (value: number) => `${value.toLocaleString("ja-JP")} JPYC`;

/** 大きく出す価格：税込の総額。Commerce が出せないときは本体価格と「税は注文時に確定」。 */
export function productPriceLabels(product: Product) {
  const tax = product.taxIncluded;
  if (tax?.status === "determined")
    return {
      main: yen(tax.priceJpyc),
      mainSuffix: "（税込）",
      note: `本体 ${yen(product.priceJpyc)}`,
      taxIncluded: true,
    };
  return { main: yen(product.priceJpyc), mainSuffix: "", note: "税は注文時に確定", taxIncluded: false };
}

/** 送料の表示。0 は「送料無料」、税込額が分かれば税込で出す。 */
export function productShippingLabel(product: Product) {
  if (product.shippingJpyc === null) return "送料は注文時に確認";
  if (product.shippingJpyc === 0) return "送料無料";
  const tax = product.taxIncluded;
  return tax?.status === "determined" && tax.shippingJpyc !== null
    ? `送料 ${yen(tax.shippingJpyc)}（税込）`
    : `送料 ${yen(product.shippingJpyc)}`;
}

/** カートの目安：税込単価×数量＋税込送料。確定額は注文時に Commerce が出す（丸めの差が1円単位で出うる）。 */
export function productLineEstimate(product: Product, quantity: number) {
  const tax = product.taxIncluded;
  if (tax?.status === "determined")
    return tax.priceJpyc * quantity + (tax.shippingJpyc ?? 0);
  return product.priceJpyc * quantity + (product.shippingJpyc ?? 0);
}

export function productStockLabel(product: Product) {
  const stock = product.stockQuantity;
  if (stock === null) return "";
  if (stock <= 0) return "在庫なし";
  return stock <= 3 ? `残り${stock}点` : "在庫あり";
}
