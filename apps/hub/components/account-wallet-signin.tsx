"use client";

import React, { useCallback, useEffect, useState } from "react";
import { UiButton } from "@/components/ui/primitives";
import { fetchAuthRequest } from "@/lib/auth-client-request";

/*
 * Account wallet sign-in (2026-10-29, owner-approved). Requests go through Hub's account proxy
 * (/account/api/*), which is a byte pass-through: Hub must not store, log, parse or inspect these bodies.
 * The message to sign is built by Account, so the wallet shows the Account domain and the user can check it.
 */
const ACCOUNT = "/account/api/v1";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type WalletRow = { id: string; address: string; chainId: number; createdAt: string };

const MESSAGES: Record<string, string> = {
  recent_authentication_required: "操作の前に、パスキーで本人確認し直してください。",
  passkey_required: "ウォレットを追加するには、先にパスキーが必要です。",
  last_credential: "このウォレットは唯一のログイン手段のため削除できません。",
  wallet_invalid: "このウォレットでは入れませんでした。登録済みのウォレットか確認してください。",
  wallet_in_use: "このウォレットは別のAccountで使われています。",
  siwe_contract_wallet_unsupported: "スマートコントラクトウォレットにはまだ対応していません。通常のアドレス（EOA）のウォレットを使ってください。",
  siwe_chain_not_allowed: "このネットワークには対応していません。ウォレットのネットワークを切り替えてください。",
  wallet_failed: "試行が多すぎます。しばらくしてからやり直してください。",
};

function provider(): Eip1193 | null {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

async function accountJson(path: string, init?: RequestInit) {
  const response = await fetchAuthRequest(`${ACCOUNT}${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "wallet_request_failed");
  return body ?? {};
}

async function signWithWallet(purpose: "signin" | "add") {
  const eth = provider();
  if (!eth) throw new Error("wallet_not_found");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (typeof address !== "string") throw new Error("wallet_not_found");
  const nonce = await accountJson("/wallets/nonce", { method: "POST", body: JSON.stringify({ purpose, address }) });
  const message = String(nonce.message);
  const signature = (await eth.request({ method: "personal_sign", params: [message, address] })) as string;
  return { message, signature };
}

function errorText(caught: unknown) {
  const code = caught instanceof Error ? caught.message : "";
  if (MESSAGES[code]) return MESSAGES[code];
  if (code === "wallet_not_found") return "ウォレットが見つかりません。ウォレット拡張機能を有効にしてください。";
  return "ウォレットの操作を完了できませんでした。";
}

const DOMAIN_NOTE = "ウォレットに表示される署名画面で、ドメインが現在開いているAccountのドメインと一致していることを確認してから署名してください。この署名は送金や承認ではありません。";

export function WalletSignInButton({ onSignedIn, disabled }: { onSignedIn: () => Promise<void>; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setPending(true);
    setError("");
    try {
      const { message, signature } = await signWithWallet("signin");
      await accountJson("/wallets/signin", { method: "POST", body: JSON.stringify({ message, signature }) });
      await onSignedIn();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="hub-auth-form" aria-label="ウォレットでログイン">
      <UiButton type="button" tone="secondary" disabled={disabled || pending} onClick={run}>{pending ? "ウォレットで確認中…" : "ウォレットでログイン"}</UiButton>
      {pending ? <small role="status">{DOMAIN_NOTE}</small> : null}
      {error ? <p className="hub-auth-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function AccountWalletList() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const body = await accountJson("/wallets");
      setWallets(Array.isArray(body.wallets) ? (body.wallets as WalletRow[]) : []);
    } catch {
      setWallets([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    setPending(true);
    setError("");
    try {
      const { message, signature } = await signWithWallet("add");
      await accountJson("/wallets/add", { method: "POST", body: JSON.stringify({ message, signature }) });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };
  const remove = async (id: string) => {
    setPending(true);
    setError("");
    try {
      await accountJson(`/wallets/${id}`, { method: "DELETE" });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="hub-auth-form" aria-label="Accountのウォレット">
      {wallets.length ? (
        <ul>
          {wallets.map((wallet) => (
            <li key={wallet.id}>
              <code>{wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</code>{" "}
              <UiButton type="button" size="compact" disabled={pending} onClick={() => remove(wallet.id)}>削除</UiButton>
            </li>
          ))}
        </ul>
      ) : <small>登録済みのウォレットはありません。</small>}
      <UiButton type="button" disabled={pending} onClick={add}>ログイン用のウォレットを追加</UiButton>
      <small>ウォレットはパスキーと並ぶ追加のログイン手段です。唯一のログイン手段にはできません。{DOMAIN_NOTE}</small>
      {error ? <p className="hub-auth-error" role="alert">{error}</p> : null}
    </section>
  );
}
