// 注文アクセストークンはタブ寿命(sessionStorage)、レシートの表示用
// メタデータは永続(localStorage)。ウォレット決済・カート決済のどちらで
// 作られた注文も同じ履歴キーへ記録し、buyerの注文一覧で再確認できる。
export const ORDER_TOKEN_PREFIX = "hub.shopping.order-token.";
export const ORDER_HISTORY_KEY = "hub.shopping.orders.v1";
export const ORDER_HISTORY_LIMIT = 50;

export function saveOrderAccessToken(
  orderId: string,
  token: string,
  storage: Pick<Storage, "setItem"> = sessionStorage,
): void {
  storage.setItem(`${ORDER_TOKEN_PREFIX}${orderId}`, token);
}

export function readOrderAccessToken(
  orderId: string,
  storage: Pick<Storage, "getItem"> = sessionStorage,
): string | null {
  return storage.getItem(`${ORDER_TOKEN_PREFIX}${orderId}`);
}

export function readOrderReceipts<T extends { id: string }>(
  storage: Pick<Storage, "getItem"> = localStorage,
): T[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ORDER_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is T =>
            Boolean(item) && typeof (item as T).id === "string",
        )
      : [];
  } catch {
    return [];
  }
}

// 同一注文の追記は既存項目を保持しながら項目単位で更新する。
// (支払い待ち → submitted → paid の経過で届く情報が増えるため)
export function recordOrderReceipt<T extends { id: string }>(
  entry: Partial<T> & { id: string },
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const stored = readOrderReceipts<T>(storage);
  const existing = stored.find((receipt) => receipt.id === entry.id);
  storage.setItem(
    ORDER_HISTORY_KEY,
    JSON.stringify(
      [
        { ...existing, ...entry },
        ...stored.filter((receipt) => receipt.id !== entry.id),
      ].slice(0, ORDER_HISTORY_LIMIT),
    ),
  );
}

// 書き込み側の一覧状態より後に別経路(ウォレット決済・別タブ)から記録された
// 注文を消さないよう、保持側に無い保存済み項目を残す。
export function mergeOrderReceipts<T extends { id: string }>(
  receipts: T[],
  storage: Pick<Storage, "getItem"> = localStorage,
): T[] {
  return [
    ...receipts,
    ...readOrderReceipts<T>(storage).filter(
      (stored) => !receipts.some((receipt) => receipt.id === stored.id),
    ),
  ].slice(0, ORDER_HISTORY_LIMIT);
}
