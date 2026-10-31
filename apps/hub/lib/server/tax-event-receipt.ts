type TaxEventReceiptInput = {
  issuer: "advertising" | "creator_revenue" | "x402";
  sourceEventId: string;
  eventKind: "advertising_spend" | "advertising_revenue" | "creator_payout" | "fee" | "refund";
  direction: "income" | "expense" | "refund_in" | "refund_out";
  currency: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  occurredAt: string;
  settlementNetwork?: string;
  settlementReference?: string;
};

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function signTaxEventReceipt(input: TaxEventReceiptInput, privateKeyPkcs8: string, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    iss: input.issuer, aud: "jkamma-commerce", purpose: "tax_event", jti: crypto.randomUUID(), iat: issuedAt, exp: issuedAt + 120,
    source_event_id: input.sourceEventId, event_kind: input.eventKind, direction: input.direction, currency: input.currency,
    net_amount: input.netAmount, tax_amount: input.taxAmount, gross_amount: input.grossAmount, occurred_at: input.occurredAt,
    ...(input.settlementNetwork ? { settlement_network: input.settlementNetwork } : {}),
    ...(input.settlementReference ? { settlement_reference: input.settlementReference } : {}),
  };
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const rawKey = Uint8Array.from(atob(privateKeyPkcs8), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", rawKey, { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}
