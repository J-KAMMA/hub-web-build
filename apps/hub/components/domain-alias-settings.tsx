"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UiButton } from "@/components/ui/primitives";

type Alias = {
  aliasId: string;
  domain: string;
  status: "pending" | "verified" | "unavailable";
  challengeExpiresAt: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  federationReady?: boolean;
  publicHandle?: string;
  verificationUrl?: string;
};

type Challenge = {
  alias: Alias;
  verificationFile: { service: string; domain: string; token: string };
};

export function DomainAliasSettings({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [alias, setAlias] = useState<Alias | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function load() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/core/domain-alias", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("load_failed");
      const body = await response.json() as { alias?: Alias | null };
      setAlias(body.alias ?? null);
    } catch {
      setFailed(true);
      setMessage(ja ? "ドメイン設定を読み込めませんでした。" : "Domain settings could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createChallenge(event: FormEvent) {
    event.preventDefault();
    if (!domain.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const response = await fetch("/api/core/domain-alias", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "challenge", domain: domain.trim() }),
      });
      if (!response.ok) throw new Error("challenge_failed");
      const body = await response.json() as Challenge;
      setChallenge(body);
      setAlias(body.alias);
      setMessage(ja ? "確認ファイルを配置してから、所有確認を押してください。" : "Publish the verification file, then verify ownership.");
    } catch {
      setFailed(true);
      setMessage(ja ? "このドメインの確認を開始できませんでした。" : "The domain challenge could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/core/domain-alias", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      if (!response.ok) throw new Error("verify_failed");
      const body = await response.json() as { alias: Alias };
      setAlias(body.alias);
      setChallenge(null);
      setMessage(body.alias.federationReady
        ? (ja ? "ドメインとWebFingerを確認しました。" : "Domain and WebFinger verified.")
        : (ja ? "ドメインを確認しました。外部検索にはWebFingerの設定も必要です。" : "Domain verified. WebFinger is still required for external discovery."));
    } catch {
      setFailed(true);
      setMessage(ja ? "確認ファイルを取得できないか、内容が一致しません。" : "The verification file is unavailable or does not match.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/core/domain-alias", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("unlink_failed");
      setAlias(null);
      setChallenge(null);
      setDomain("");
      setMessage(ja ? "公開ドメインを解除しました。" : "Public domain removed.");
    } catch {
      setFailed(true);
      setMessage(ja ? "公開ドメインを解除できませんでした。" : "The public domain could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const verificationJson = challenge ? JSON.stringify(challenge.verificationFile, null, 2) : "";

  return (
    <div className="settings-card domain-alias-settings" aria-busy={busy}>
      <div className="settings-note">
        <strong>{ja ? "公開ドメイン" : "Public domain"}</strong>
        <p>{ja ? "確認済みドメインを公開別名として使います。ログインと復旧は引き続きパスキーで行い、ドメインを認証情報にはしません。" : "Use a verified domain as a public alias. Sign-in and recovery remain passkey-only; the domain is never a login credential."}</p>
      </div>

      {!alias || alias.status !== "verified" ? (
        <form className="domain-alias-settings__form" onSubmit={createChallenge}>
          <label htmlFor="domain-alias-input">{ja ? "ドメイン" : "Domain"}</label>
          <div className="domain-alias-settings__entry">
            <input id="domain-alias-input" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" disabled={busy} required />
            <UiButton type="submit" size="compact" disabled={busy}>{ja ? "確認を開始" : "Start verification"}</UiButton>
          </div>
        </form>
      ) : null}

      {challenge ? (
        <div className="settings-note">
          <strong>{challenge.alias.verificationUrl}</strong>
          <p>{ja ? "このURLへ次のJSONを公開します。確認用トークンはログインや署名には使えません。" : "Publish this JSON at the URL above. The token cannot be used for login or signing."}</p>
          <pre className="domain-alias-settings__code">{verificationJson}</pre>
          <div className="settings-actions">
            <UiButton type="button" size="compact" disabled={busy} onClick={() => void navigator.clipboard.writeText(verificationJson)}>{ja ? "JSONをコピー" : "Copy JSON"}</UiButton>
            <UiButton type="button" size="compact" disabled={busy} onClick={() => void verify()}>{ja ? "所有確認" : "Verify ownership"}</UiButton>
          </div>
        </div>
      ) : null}

      {alias?.status === "verified" ? (
        <div className="settings-note">
          <span className="settings-badge">{alias.federationReady ? "WebFinger ready" : "Domain verified"}</span>
          <strong className="domain-alias-settings__handle">{alias.publicHandle ?? `@${alias.domain}`}</strong>
          <p>{alias.federationReady
            ? (ja ? "外部SNSからもこの別名を検索できます。" : "External social services can discover this alias.")
            : (ja ? "公開別名は有効です。外部SNSから検索可能にするには、所有者側ドメインへWebFingerを設定してください。" : "The public alias is active. Configure WebFinger on your domain for external discovery.")}</p>
          <div className="settings-actions">
            <UiButton type="button" size="compact" disabled={busy} onClick={() => void verify()}>{ja ? "再確認" : "Recheck"}</UiButton>
            <UiButton type="button" size="compact" disabled={busy} onClick={() => void unlink()}>{ja ? "解除" : "Remove"}</UiButton>
          </div>
        </div>
      ) : null}

      {message ? <p className="settings-note" role={failed ? "alert" : "status"}>{message}</p> : null}
    </div>
  );
}
