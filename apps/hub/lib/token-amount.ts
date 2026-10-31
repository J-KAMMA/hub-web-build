export function formatRawTokenAmount(rawAmount: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(rawAmount))
    throw new Error("token_raw_amount_invalid");
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error("token_decimals_invalid");
  if (decimals === 0) return rawAmount;
  const padded = rawAmount.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

export function formatTokenAmountForDisplay(value: string, maximumFractionDigits = 8): string {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return "0";
  const [integer, fraction = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const visible = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  const truncated = fraction.slice(maximumFractionDigits).replace(/0/g, "").length > 0;
  return `${grouped}${visible ? `.${visible}` : ""}${truncated ? "…" : ""}`;
}
