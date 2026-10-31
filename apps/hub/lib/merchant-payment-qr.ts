export type MerchantPaymentRequest = {
  productId: string;
  quantity: number;
  billingCountry: string;
  currency: "JPYC" | "USDC";
  chainId: number;
  expiresAt?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function merchantPaymentUrl(origin: string, request: MerchantPaymentRequest): string {
  if (!/^https?:\/\//.test(origin) || !UUID.test(request.productId)) throw new Error("invalid_payment_request");
  if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 20) throw new Error("invalid_payment_request");
  const country = request.billingCountry.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !["JPYC","USDC"].includes(request.currency) || !Number.isSafeInteger(request.chainId) || request.chainId < 1) throw new Error("invalid_payment_request");
  const url = new URL("/wallet/pay", origin);
  url.searchParams.set("productId", request.productId);
  url.searchParams.set("quantity", String(request.quantity));
  url.searchParams.set("country", country);
  url.searchParams.set("currency", request.currency);
  url.searchParams.set("chainId", String(request.chainId));
  url.searchParams.set("expiresAt", String(request.expiresAt ?? Date.now() + 30 * 60_000));
  return url.toString();
}

export function parseMerchantPaymentRequest(url: URL): MerchantPaymentRequest | null {
  const productId = url.searchParams.get("productId") ?? "";
  const quantity = Number(url.searchParams.get("quantity"));
  const billingCountry = (url.searchParams.get("country") ?? "").toUpperCase();
  const expiresAt = Number(url.searchParams.get("expiresAt"));
  const currency = url.searchParams.get("currency"); const chainId = Number(url.searchParams.get("chainId"));
  if (!UUID.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !/^[A-Z]{2}$/.test(billingCountry) || (currency!=="JPYC"&&currency!=="USDC") || !Number.isSafeInteger(chainId) || chainId<1 || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 31 * 60_000) return null;
  return { productId, quantity, billingCountry, currency, chainId, expiresAt };
}
