export const WALLET_ORDER_SESSION_KEY = "hub.wallet.order-access.v1";

export type WalletOrderAccess = {
  orderId: string;
  accessToken: string;
  productTitle: string;
  createdAt: string;
};

function valid(value: unknown): value is WalletOrderAccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.orderId === "string" && /^[0-9a-f-]{36}$/i.test(item.orderId)
    && typeof item.accessToken === "string" && item.accessToken.length >= 32 && item.accessToken.length <= 256
    && typeof item.productTitle === "string" && item.productTitle.length > 0 && item.productTitle.length <= 200
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt));
}

export function readWalletOrderSession(storage: Pick<Storage, "getItem"> = sessionStorage): WalletOrderAccess[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(WALLET_ORDER_SESSION_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, 50) : [];
  } catch { return []; }
}

export function saveWalletOrderSession(entry: WalletOrderAccess, storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage): void {
  if (!valid(entry)) throw new Error("invalid_wallet_order_access");
  const next = [entry, ...readWalletOrderSession(storage).filter((item) => item.orderId !== entry.orderId)].slice(0, 50);
  storage.setItem(WALLET_ORDER_SESSION_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("hub-wallet-orders-updated"));
}

export function removeWalletOrderSession(orderId: string, storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage): void {
  storage.setItem(WALLET_ORDER_SESSION_KEY, JSON.stringify(readWalletOrderSession(storage).filter((item) => item.orderId !== orderId)));
}
