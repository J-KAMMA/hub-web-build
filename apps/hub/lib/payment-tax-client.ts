const COMMERCE_TAX_EVENTS = "/shopping/api/commerce/api/v1/payment/tax/events";

export async function recordPaymentTaxEvent(receipt: unknown): Promise<boolean> {
  if (typeof receipt !== "string" || receipt.length < 32 || receipt.length > 8_192) return false;
  const assertionResponse = await fetch("/account/api/v1/assertions/payment-tax-event", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  if (!assertionResponse.ok) return false;
  const assertionBody = await assertionResponse.json().catch(() => null) as { assertion?: unknown } | null;
  if (typeof assertionBody?.assertion !== "string") return false;
  const response = await fetch(COMMERCE_TAX_EVENTS, {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${assertionBody.assertion}` },
    body: JSON.stringify({ receipt }),
  });
  return response.ok;
}
