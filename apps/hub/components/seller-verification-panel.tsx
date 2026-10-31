"use client";

import React, { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useHubWallet } from "@/components/hub-wallet-provider";

type VerificationStatus = "not_started" | "pending" | "verified" | "rejected";
const ACCOUNT_API = "/account/api/v1";
const IDENTITY_API = "/identity/api";
const COMMERCE_API = "/shopping/api/commerce/api/v1";

type OnboardingChallenge = {
  challengeId: string;
  message: string;
  expiresAt: string;
  summary: {
    publicName: string;
    payoutWallet: string;
    legalDisplayUrl: string;
  };
};

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function accountRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${ACCOUNT_API}${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", ...init?.headers },
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "account_unavailable");
  return body;
}

async function issueIdentityAssertion() {
  const body = await accountRequest("/assertions/identity", { method: "POST" });
  if (typeof body.assertion !== "string") throw new Error("assertion_unavailable");
  return body.assertion;
}

async function ensureIdentityLink() {
  const status = await accountRequest("/links/identity");
  if (status.linked === true) return;
  await accountRequest("/links/identity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

function statusLabel(status: VerificationStatus) {
  if (status === "verified") return "確認済み";
  if (status === "pending") return "確認中";
  if (status === "rejected") return "再確認が必要";
  return "未確認";
}

function errorLabel(error: unknown) {
  const code = error instanceof Error ? error.message : "verification_unavailable";
  if (code === "unauthorized") return "Accountへログインしてください。";
  if (code === "recent_authentication_required") return "安全のため、Accountへもう一度ログインしてください。";
  if (code === "identity_link_required") return "Identityとの連携を完了できませんでした。";
  if (code === "Seller verification provider is unavailable") return "販売者確認サービスは現在利用できません。";
  if (code === "seller_already_registered") return "この本人確認または受取ウォレットは、すでに販売者登録されています。状態を更新してください。";
  if (code === "seller_onboarding_challenge_expired") return "確認時間を過ぎました。登録内容の確認からやり直してください。";
  if (code === "seller_onboarding_challenge_consumed") return "この確認はすでに使用済みです。販売者状態を更新してください。";
  if (code === "invalid_wallet_signature") return "選択した受取ウォレットの署名を確認できませんでした。";
  if (code === "seller_onboarding_origin_changed") return "登録を開始した画面と現在の画面が一致しません。最初からやり直してください。";
  if (code === "seller_proof_unavailable") return "販売者確認済み証明を発行できませんでした。";
  if (code === "seller_challenge_unavailable") return "受取ウォレットの確認を開始できませんでした。";
  if (code === "seller_registration_failed") return "販売者登録を完了できませんでした。";
  return "販売者確認の状態を取得できませんでした。";
}

export function SellerVerificationPanel({
  onSellerSessionCreated,
}: {
  onSellerSessionCreated?: () => void | Promise<void>;
}) {
  const wallet = useHubWallet();
  const [status, setStatus] = useState<VerificationStatus>("not_started");
  const [accountAuthenticated, setAccountAuthenticated] = useState<boolean | null>(null);
  const [accountDisplayName, setAccountDisplayName] = useState("");
  const [personType, setPersonType] = useState<"individual" | "business">("individual");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("販売者確認の状態を確認しています。");
  const [publicName, setPublicName] = useState("");
  const [legalDisplayUrl, setLegalDisplayUrl] = useState("");
  const [onboarding, setOnboarding] = useState<OnboardingChallenge | null>(null);

  async function refresh() {
    setBusy(true);
    try {
      const link = await accountRequest("/links/identity");
      setAccountAuthenticated(true);
      if (link.linked !== true) {
        setLinked(false);
        setStatus("not_started");
        setMessage("販売者確認を始めると、AccountとIdentityを明示的に連携します。");
        return;
      }
      setLinked(true);
      const assertion = await issueIdentityAssertion();
      const response = await fetch(`${IDENTITY_API}/seller-verification/status`, {
        headers: { authorization: `Bearer ${assertion}`, accept: "application/json" },
        cache: "no-store",
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "verification_unavailable");
      const next: VerificationStatus =
        body.status === "pending" || body.status === "verified" || body.status === "rejected"
          ? body.status
          : "not_started";
      setStatus(next);
      setMessage(
        next === "verified"
          ? "販売者確認が完了しています。"
          : next === "pending"
            ? "審査結果を待っています。"
            : next === "rejected"
              ? "内容を確認し、もう一度申請してください。"
              : "商品を公開する前に販売者確認を完了してください。",
      );
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") {
        setAccountAuthenticated(false);
      }
      setMessage(errorLabel(error));
    } finally {
      setBusy(false);
    }
  }

  async function registerAccount() {
    if (!accountDisplayName.trim()) {
      setMessage("表示名を入力してください。");
      return;
    }
    setBusy(true);
    try {
      const begin = await accountRequest("/passkeys/register/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: accountDisplayName.trim() }),
      });
      const credential = await startRegistration({ optionsJSON: begin.options as never });
      await accountRequest("/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential),
      });
      setAccountAuthenticated(true);
      setMessage("Accountを作成しました。続けて販売者確認を始めてください。");
      await refresh();
    } catch (error) {
      setMessage(`Accountを作成できませんでした: ${error instanceof Error ? error.message : "registration_failed"}`);
    } finally {
      setBusy(false);
    }
  }

  async function loginAccount() {
    setBusy(true);
    try {
      const begin = await accountRequest("/passkeys/authenticate/options", { method: "POST" });
      const credential = await startAuthentication({ optionsJSON: begin.options as never });
      await accountRequest("/passkeys/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential),
      });
      setAccountAuthenticated(true);
      setMessage("Accountへログインしました。続けて販売者確認を始めてください。");
      await refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "authentication_failed";
      setMessage(
        code === "passkey_invalid"
          ? "選択したパスキーは共通Accountに未登録です。表示名を入力して「パスキーで新規登録」を選んでください。Hub専用パスキーとは別に、この端末へAccount用パスキーを追加します。"
          : `Accountへログインできませんでした: ${code}`,
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function startVerification() {
    setBusy(true);
    try {
      await ensureIdentityLink();
      setLinked(true);
      const assertion = await issueIdentityAssertion();
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set("seller_verification", "returned");
      const response = await fetch(`${IDENTITY_API}/seller-verification/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${assertion}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ country: "JP", person_type: personType, return_url: returnUrl.toString() }),
      });
      const body = await readJson(response);
      if (!response.ok || typeof body.redirect_url !== "string") {
        throw new Error(typeof body.error === "string" ? body.error : "verification_unavailable");
      }
      window.location.assign(body.redirect_url);
    } catch (error) {
      setMessage(errorLabel(error));
      setBusy(false);
    }
  }

  async function unlinkIdentity() {
    setBusy(true);
    try {
      await accountRequest("/links/identity", { method: "DELETE" });
      setLinked(false);
      setStatus("not_started");
      setMessage("AccountとIdentityの連携を解除しました。Identityが保有する審査記録は自動削除されません。");
    } catch (error) {
      setMessage(errorLabel(error));
    } finally {
      setBusy(false);
    }
  }

  async function prepareSellerRegistration() {
    if (!wallet.address) {
      setMessage("販売代金を受け取るウォレットを接続してください。");
      return;
    }
    setBusy(true);
    try {
      const accountAssertion = await issueIdentityAssertion();
      const proofResponse = await fetch(`${IDENTITY_API}/commerce/assertions/seller`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accountAssertion}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: "{}",
      });
      const proof = await readJson(proofResponse);
      if (!proofResponse.ok || typeof proof.assertion !== "string") {
        throw new Error(typeof proof.error === "string" ? proof.error : "seller_proof_unavailable");
      }
      const challengeResponse = await fetch(`${COMMERCE_API}/seller/onboarding/challenge`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          identityAssertion: proof.assertion,
          publicName: publicName.trim(),
          payoutWallet: wallet.address,
          legalDisplayUrl: legalDisplayUrl.trim(),
        }),
      });
      const challenge = await readJson(challengeResponse);
      if (
        !challengeResponse.ok ||
        typeof challenge.challengeId !== "string" ||
        typeof challenge.message !== "string" ||
        typeof challenge.expiresAt !== "string" ||
        typeof challenge.summary !== "object" ||
        challenge.summary === null
      ) {
        throw new Error(
          typeof challenge.error === "string" ? challenge.error : "seller_challenge_unavailable",
        );
      }
      setOnboarding(challenge as unknown as OnboardingChallenge);
      setMessage("登録内容を確認してから、ウォレットで所有確認に署名してください。");
    } catch (error) {
      setMessage(errorLabel(error));
    } finally {
      setBusy(false);
    }
  }

  async function completeSellerRegistration() {
    if (!onboarding || !wallet.address) return;
    setBusy(true);
    try {
      const signature = await wallet.signMessage(onboarding.message);
      const response = await fetch(`${COMMERCE_API}/seller/onboarding/complete`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          challengeId: onboarding.challengeId,
          signature,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "seller_registration_failed");
      }
      setOnboarding(null);
      setMessage("販売者登録が完了しました。");
      await onSellerSessionCreated?.();
    } catch (error) {
      setMessage(errorLabel(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="commerce-seller-login commerce-seller-verification" aria-labelledby="seller-verification-title">
      <div>
        <small>販売者確認</small>
        <h2 id="seller-verification-title">{statusLabel(status)}</h2>
        <p>{message}</p>
      </div>
      <div className="commerce-seller-verification__actions">
        {accountAuthenticated === false ? (
          <div className="commerce-seller-account-auth">
            <label>
              新規登録の表示名
              <input
                value={accountDisplayName}
                maxLength={80}
                autoComplete="nickname"
                placeholder="例：J Kamma"
                onChange={(event) => setAccountDisplayName(event.target.value)}
                disabled={busy}
              />
            </label>
            <button type="button" disabled={busy || !accountDisplayName.trim()} onClick={() => void registerAccount()}>
              パスキーで新規登録
            </button>
            <button className="is-secondary" type="button" disabled={busy} onClick={() => void loginAccount()}>
              登録済みAccountへログイン
            </button>
          </div>
        ) : null}
        {status !== "verified" ? (
          <label>
            申請区分
            <select value={personType} onChange={(event) => setPersonType(event.target.value === "business" ? "business" : "individual")} disabled={busy}>
              <option value="individual">個人</option>
              <option value="business">法人・事業者</option>
            </select>
          </label>
        ) : null}
        <button type="button" disabled={busy || accountAuthenticated === false} onClick={() => void (status === "verified" ? refresh() : startVerification())}>
          {status === "verified" ? "状態を更新" : status === "pending" ? "申請を確認する" : "販売者確認を始める"}
        </button>
        {linked ? (
          <button className="is-secondary" type="button" disabled={busy} onClick={() => void unlinkIdentity()}>
            連携を解除
          </button>
        ) : null}
      </div>
      {status === "verified" ? (
        <div className="commerce-seller-onboarding">
          <h3>Commerce販売者登録</h3>
          <p>
            本人確認情報はCommerceへ渡しません。公開名と受取ウォレット、販売条件のURLだけを登録します。
          </p>
          <label>
            公開名
            <input
              value={publicName}
              maxLength={100}
              autoComplete="organization"
              onChange={(event) => {
                setPublicName(event.target.value);
                setOnboarding(null);
              }}
              disabled={busy}
              required
            />
          </label>
          <label>
            販売条件・返品表示のURL
            <input
              type="url"
              value={legalDisplayUrl}
              placeholder="https://example.com/legal/commerce"
              onChange={(event) => {
                setLegalDisplayUrl(event.target.value);
                setOnboarding(null);
              }}
              disabled={busy}
              required
            />
          </label>
          <div className="commerce-seller-wallet-summary">
            <span>受取ウォレット</span>
            <strong>{wallet.address ?? "未接続"}</strong>
            {!wallet.address ? (
              <button type="button" disabled={busy} onClick={() => void wallet.connect()}>
                ウォレットを接続
              </button>
            ) : null}
          </div>
          {!onboarding ? (
            <button
              type="button"
              disabled={
                busy ||
                !wallet.address ||
                !publicName.trim() ||
                !legalDisplayUrl.trim().startsWith("https://")
              }
              onClick={() => void prepareSellerRegistration()}
            >
              登録内容を確認
            </button>
          ) : (
            <section className="commerce-seller-onboarding__preview" aria-labelledby="seller-onboarding-preview">
              <h4 id="seller-onboarding-preview">署名前の確認</h4>
              <dl>
                <div><dt>公開名</dt><dd>{onboarding.summary.publicName}</dd></div>
                <div><dt>受取ウォレット</dt><dd>{onboarding.summary.payoutWallet}</dd></div>
                <div><dt>販売条件</dt><dd>{onboarding.summary.legalDisplayUrl}</dd></div>
              </dl>
              <p>
                この署名は受取ウォレットの所有確認だけに使います。送金、トークン承認、継続的な権限付与は行いません。
              </p>
              <div>
                <button type="button" className="is-secondary" disabled={busy} onClick={() => setOnboarding(null)}>
                  内容を修正
                </button>
                <button type="button" disabled={busy} onClick={() => void completeSellerRegistration()}>
                  この内容で署名して登録
                </button>
              </div>
            </section>
          )}
        </div>
      ) : null}
    </section>
  );
}
