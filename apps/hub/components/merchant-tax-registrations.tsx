"use client";

import { useEffect, useState, type FormEvent } from "react";

const COMMERCE = "/shopping/api/commerce/api/v1";

type Registration = {
  id: string;
  countryCode: string;
  subdivisionCode: string;
  registrationKind: string;
  validFrom: string;
  validTo: string | null;
  verificationStatus: "pending" | "verified" | "rejected" | "expired";
};

const statusLabel: Record<Registration["verificationStatus"], string> = {
  pending: "確認待ち",
  verified: "確認済み",
  rejected: "要修正",
  expired: "期限切れ",
};

export function MerchantTaxRegistrations() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [countries, setCountries] = useState<string[]>(["JP"]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [registrationResponse, countryResponse] = await Promise.all([
      fetch(`${COMMERCE}/seller/tax/registrations`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${COMMERCE}/payment/jurisdictions`, { cache: "no-store" }),
    ]);
    if (registrationResponse.ok) {
      const body = (await registrationResponse.json()) as {
        registrations: Registration[];
      };
      setRegistrations(body.registrations);
    }
    if (countryResponse.ok) {
      const body = (await countryResponse.json()) as { countries: string[] };
      setCountries(body.countries);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${COMMERCE}/seller/tax/registrations`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          countryCode: form.get("countryCode"),
          subdivisionCode: form.get("subdivisionCode") || "*",
          registrationKind: form.get("registrationKind"),
          validFrom: form.get("validFrom"),
          validTo: form.get("validTo") || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "登録できませんでした。");
      event.currentTarget.reset();
      await load();
      setMessage("税務登録を確認待ちとして追加しました。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "登録できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="commerce-product-form">
      <div className="commerce-form-heading">
        <div>
          <h2>税務登録地域</h2>
        </div>
      </div>
      <p>
        税番号そのものはHubへ保存しません。登録地域と確認状態だけをCommerceで管理します。
      </p>
      {registrations.length ? (
        <ul>
          {registrations.map((registration) => (
            <li key={registration.id}>
              <strong>
                {registration.countryCode}
                {registration.subdivisionCode === "*"
                  ? ""
                  : ` / ${registration.subdivisionCode}`}
              </strong>{" "}
              <span>{registration.registrationKind}</span>{" "}
              <small>{statusLabel[registration.verificationStatus]}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>登録済みの地域はありません。</p>
      )}
      <form onSubmit={submit}>
        <label>
          国・地域
          <select name="countryCode" defaultValue="JP">
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <label>
          州・地域コード
          <input
            name="subdivisionCode"
            placeholder="例: US-CA（国全体は空欄）"
          />
        </label>
        <label>
          登録種別
          <select name="registrationKind" defaultValue="vat">
            <option value="vat">VAT</option>
            <option value="gst">GST</option>
            <option value="sales_tax">Sales tax</option>
            <option value="consumption_tax">Consumption tax</option>
          </select>
        </label>
        <label>
          有効開始日
          <input name="validFrom" type="date" required />
        </label>
        <label>
          有効終了日
          <input name="validTo" type="date" />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "登録中…" : "確認を申請"}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
