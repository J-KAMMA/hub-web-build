"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import React, {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AsyncActionButton } from "./async-action-button";
import { AccountWalletList, WalletSignInButton } from "./account-wallet-signin";
import { UiButton, UiInput } from "@/components/ui/primitives";
import {
  AuthRequestTimeoutError,
  fetchAuthRequest,
} from "@/lib/auth-client-request";
import { safeHubReturnPath } from "@/lib/auth-return-path";
import { HUB_MINIMUM_AGE } from "@/lib/hub-consent";

type AuthMode = "login" | "signup";
type RecoveryStage = "code" | "passkey" | "hub-link";
const ACCOUNT = "/account/api/v1";
const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,32}$/;
const PASSKEY_WAIT_MS = 60_000;
const SESSION_CHECK_TIMEOUT_MS = 8_000;
const RECOVERY_STAGE_KEY = "hub.auth.recovery-stage.v1";

async function withPasskeyTimeout<T>(ceremony: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      WebAuthnAbortService.cancelCeremony();
      reject(new Error("passkey_timeout"));
    }, PASSKEY_WAIT_MS);
  });
  try {
    return await Promise.race([ceremony, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function errorCode(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error : fallback;
}

function passkeyError(error: unknown) {
  const details = error && typeof error === "object" ? error as { code?: unknown; name?: unknown; message?: unknown } : null;
  const code = typeof details?.code === "string" ? details.code : "";
  const name = typeof details?.name === "string" ? details.name : "";
  const diagnosticMessage = typeof details?.message === "string"
    ? details.message.replace(/[\r\n\t]+/gu, " ").slice(0, 240)
    : "";
  const diagnosticValue = diagnosticMessage || (typeof error === "string"
    ? error.replace(/[\r\n\t]+/gu, " ").slice(0, 240)
    : "");
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "BraveまたはWindows Helloに、このAccountの古いパスキーが残っています。端末のパスキー設定から localhost の古い登録を削除して、もう一度お試しください。";
  if (code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT") return "Braveがパスキーを保存できる認証器を見つけられませんでした。Windows Helloを有効にするか、パスキーの保存先としてこのWindowsデバイスを選んでください。";
  if (code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" || code === "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE") return "本人確認に使えるWindows Helloが見つかりませんでした。Windowsのサインイン オプションでPINを設定してから、もう一度お試しください。";
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") return "このサイトではパスキーを確認できません。登録したAccountのログイン画面から開き直してください。解決しない場合は管理者へお問い合わせください。";
  if (code === "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG" || code === "ERROR_MALFORMED_PUBKEYCREDPARAMS") return "Braveまたは認証器が対応するパスキー方式を利用できません。BraveとWindowsを更新して、もう一度お試しください。";
  if (code === "ERROR_AUTHENTICATOR_GENERAL_ERROR") return "BraveまたはWindows Helloがパスキーを作成できませんでした。Braveのパスキー保存先とWindows HelloのPINを確認して、もう一度お試しください。";
  if (name === "NotAllowedError" || name === "AbortError") return "パスキーの操作がキャンセルされたか、時間切れになりました。Braveのアドレスバー付近に確認アイコンが残っていないか確認してください。";
  if (name === "InvalidStateError") return "この端末には同じパスキーがすでに登録されています。";
  if (name === "ConstraintError") return "Windows Helloが、このパスキーに必要な端末保存または本人確認に対応していません。Windows HelloのPIN設定を確認してください。";
  if (name === "NotSupportedError") return "BraveまたはWindows Helloが要求されたパスキー方式に対応していません。BraveとWindowsを更新してください。";
  if (name === "SecurityError") return "パスキーのサイト確認に失敗しました。登録したAccountのログイン画面か、接続先のURLを確認してください。解決しない場合は管理者へお問い合わせください。";
  if (name === "UnknownError") return "Windows Helloがパスキーを作成できませんでした。Braveを完全に終了して開き直すか、Windowsのパスキー設定に残る localhost の古い登録を確認してください。";
  if (name === "TypeError") return process.env.NODE_ENV !== "production" && diagnosticMessage
    ? `Braveがパスキー作成情報を処理できませんでした。開発診断: ${diagnosticMessage}`
    : "Braveがパスキー作成情報を処理できませんでした。ページを再読み込みして、もう一度お試しください。";
  if (process.env.NODE_ENV !== "production" && diagnosticValue) {
    return `パスキー処理に失敗しました。開発診断 (${name || typeof error}): ${diagnosticValue}`;
  }
  return "パスキーを確認できませんでした。端末の設定を確認して、もう一度お試しください。";
}

function readRecoveryStage(): RecoveryStage {
  try {
    const value = window.sessionStorage.getItem(RECOVERY_STAGE_KEY);
    return value === "passkey" || value === "hub-link" ? value : "code";
  } catch {
    return "code";
  }
}

function persistRecoveryStage(stage: RecoveryStage) {
  try {
    if (stage === "code") {
      window.sessionStorage.removeItem(RECOVERY_STAGE_KEY);
    } else {
      window.sessionStorage.setItem(RECOVERY_STAGE_KEY, stage);
    }
  } catch {
    // The Account session cookie remains authoritative if browser storage is unavailable.
  }
}

async function accountRequest(path: string, init?: RequestInit) {
  const response = await fetchAuthRequest(`${ACCOUNT}${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const fallback = response.status === 403 && path === "/passkeys/register/options"
    ? "recent_authentication_required"
    : "account_request_failed";
  if (!response.ok) throw new Error(errorCode(body, fallback));
  return body ?? {};
}

function braveCompatibleRegistrationOptions(value: unknown) {
  let candidate = value;
  for (let depth = 0; depth < 3; depth += 1) {
    const response = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
    if (response && "options" in response) {
      candidate = response.options;
      continue;
    }
    if (response && "optionsJSON" in response) {
      candidate = response.optionsJSON;
      continue;
    }
    break;
  }
  if (!candidate || typeof candidate !== "object") throw new Error("registration_options_unavailable");
  const options = candidate as PublicKeyCredentialCreationOptionsJSON & { hints?: unknown };
  if (
    typeof options.challenge !== "string"
    || !options.rp
    || !options.user
    || !Array.isArray(options.pubKeyCredParams)
  ) throw new Error("registration_options_invalid");
  const { hints: _unsupportedHints, ...compatible } = options;
  return compatible as PublicKeyCredentialCreationOptionsJSON;
}

async function finishHubAccountLogin(profile?: { handle: string; displayName: string }) {
  /* 新しいプロフィールを作る要求にだけ、規約への同意と16歳以上の確認を添える（サーバーも同じ条件で確かめる）。 */
  const status = await fetchAuthRequest(`${ACCOUNT}/links/hub`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (status.status === 401) throw new Error("account_login_required");
  if (!status.ok) throw new Error(errorCode(await status.json().catch(() => null), "hub_link_failed"));
  const linked = await status.json() as { linked?: boolean };
  if (!linked.linked) await accountRequest("/links/hub", { method: "POST", body: "{}" });
  const issued = await accountRequest("/assertions/hub", { method: "POST", body: "{}" });
  if (typeof issued.assertion !== "string") throw new Error("assertion_unavailable");
  const response = await fetchAuthRequest("/api/auth/account/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assertion: issued.assertion, ...(profile ? { ...profile, acceptedTerms: true, confirmedMinimumAge: true } : {}) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorCode(result, "hub_session_failed"));
}

async function recoverHubProfile(token: string) {
  const status = await fetchAuthRequest(`${ACCOUNT}/links/hub`, { credentials: "same-origin", cache: "no-store" });
  if (status.status === 401) throw new Error("account_login_required");
  if (!status.ok) throw new Error("hub_link_failed");
  const linked = await status.json() as { linked?: boolean };
  if (!linked.linked) await accountRequest("/links/hub", { method: "POST", body: "{}" });
  const issued = await accountRequest("/assertions/hub", { method: "POST", body: "{}" });
  const response = await fetchAuthRequest("/api/auth/account/profile-recovery", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assertion: issued.assertion, token }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorCode(result, "profile_recovery_failed"));
}

export function HubAuthPanel({
  returnTo = "/",
  reauthenticate = false,
}: {
  returnTo?: string;
  reauthenticate?: boolean;
}) {
  /* 読み手が居る面。v2 から描かれたら入口も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const router = useRouter();
  const safeReturnTo = safeHubReturnPath(returnTo);
  const onboardingPath = hubSurfacePath(surface, "/onboarding");
  const onboardingHref = /^\/(?:v2\/)?onboarding(?:[?#]|$)/.test(safeReturnTo)
    ? hubSurfacePath(surface, safeReturnTo)
    : safeReturnTo === "/" || safeReturnTo === "/v2"
      ? onboardingPath : `${onboardingPath}?next=${encodeURIComponent(safeReturnTo)}`;
  const [mode, setMode] = useState<AuthMode>("login");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [confirmedMinimumAge, setConfirmedMinimumAge] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [sessionNotice, setSessionNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [profileOnly, setProfileOnly] = useState(false);
  const [accountAuthenticated, setAccountAuthenticated] = useState(false);
  const [passkeyNotice, setPasskeyNotice] = useState("");
  const [passkeyAddError, setPasskeyAddError] = useState("");
  const [hasLegacyProfile, setHasLegacyProfile] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryStage, setRecoveryStage] = useState<RecoveryStage>("code");
  const [oauthProviders, setOauthProviders] = useState({ google: false, apple: false });
  const [externalLoginFailure, setExternalLoginFailure] = useState<"failed" | "conflict" | null>(null);
  const sessionCheckController = useRef<AbortController | null>(null);
  const oauthHandled = useRef(false);

  const rememberRecoveryStage = (stage: RecoveryStage) => {
    setRecoveryStage(stage);
    persistRecoveryStage(stage);
  };

  const checkSession = useCallback(async () => {
    const oauthRejected = ["failed", "conflict"].includes(new URLSearchParams(window.location.search).get("oauth") ?? "");
    sessionCheckController.current?.abort();
    const controller = new AbortController();
    sessionCheckController.current = controller;
    setCheckingSession(true);
    setSessionCheckFailed(false);
    setSessionNotice("");
    setError("");
    try {
      const [response, accountResponse] = await Promise.all([
        fetchAuthRequest(
          "/api/auth/session",
          { cache: "no-store", signal: controller.signal },
          SESSION_CHECK_TIMEOUT_MS,
        ),
        fetchAuthRequest(
          `${ACCOUNT}/session`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
          SESSION_CHECK_TIMEOUT_MS,
        ),
      ]);
      if (!response.ok) throw new Error("hub_session_check_failed");
      if (!accountResponse.ok && accountResponse.status !== 401) {
        throw new Error("account_session_check_failed");
      }
      const payload = await response.json().catch(() => null) as {
        profile?: { handle?: string; displayName?: string };
        accountLinked?: boolean;
        authenticated?: boolean;
      } | null;
      if (!payload) throw new Error("hub_session_check_failed");
      const accountAuthenticated = accountResponse.ok;
      setAccountAuthenticated(accountAuthenticated);
      if (
        !reauthenticate
        && !oauthRejected
        && !payload.profile
        && payload.authenticated !== true
        && readRecoveryStage() === "code"
      ) {
        const localAutoLogin = await fetchAuthRequest(
          "/api/auth/session?local=auto",
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: "{}",
            signal: controller.signal,
          },
          SESSION_CHECK_TIMEOUT_MS,
        );
        if (localAutoLogin.ok) {
          router.replace(safeReturnTo);
          router.refresh();
          return;
        }
        if (localAutoLogin.status !== 404) throw new Error("local_auto_login_failed");
      }
      if (response.ok && payload?.profile && payload.accountLinked && payload.authenticated) {
        if (reauthenticate) {
          setSessionNotice("安全な操作を続けるため、共通Accountのパスキーでもう一度本人確認してください。");
        } else if (readRecoveryStage() !== "code") {
          setSessionNotice("Account復旧はまだ完了していません。確認済みの段階から再開してください。");
        } else if (!oauthRejected) {
          router.replace(safeReturnTo);
          router.refresh();
        }
      } else if (response.ok && payload?.profile && !oauthRejected) {
        setHasLegacyProfile(true);
        setHandle(payload.profile.handle ?? "");
        setDisplayName(payload.profile.displayName ?? "");
        if (!reauthenticate) setMode("signup");
        setProfileOnly(accountAuthenticated);
        setSessionNotice(accountAuthenticated
          ? "Accountにログイン済みです。Hubプロフィールとの連携を完了してください。"
          : "以前のHubプロフィールを確認済みです。表示名を入力し、共通パスキーを作成してください。");
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setSessionCheckFailed(true);
      setError(caught instanceof AuthRequestTimeoutError
        ? "認証状態の確認が時間切れになりました。通信状態を確認して、もう一度お試しください。"
        : "認証状態を確認できませんでした。通信状態を確認して、もう一度お試しください。");
    } finally {
      if (sessionCheckController.current === controller) {
        sessionCheckController.current = null;
        setCheckingSession(false);
      }
    }
  }, [reauthenticate, router, safeReturnTo]);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    const storedRecoveryStage = readRecoveryStage();
    if (storedRecoveryStage !== "code") {
      setRecoveryStage(storedRecoveryStage);
      setRecoveryOpen(true);
      setHelpOpen(true);
      setSessionNotice(storedRecoveryStage === "passkey"
        ? "復旧コードは確認済みです。新しいパスキーの作成を再開できます。"
        : "新しいパスキーは作成済みです。Hubとの連携を完了できます。");
    }
    void checkSession();
    return () => {
      const activeController = sessionCheckController.current;
      sessionCheckController.current = null;
      activeController?.abort();
      WebAuthnAbortService.cancelCeremony();
    };
  }, [checkSession]);

  useEffect(() => {
    void fetchAuthRequest(`${ACCOUNT}/oauth/providers`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (payload && typeof payload === "object") setOauthProviders({
          google: (payload as { google?: unknown }).google === true,
          apple: (payload as { apple?: unknown }).apple === true,
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const recoveryToken = new URLSearchParams(window.location.hash.slice(1)).get("profile_recovery");
    const oauthResult = new URLSearchParams(window.location.search).get("oauth");
    if (!oauthHandled.current && !recoveryToken && (oauthResult === "failed" || oauthResult === "conflict")) {
      oauthHandled.current = true;
      setExternalLoginFailure(oauthResult);
      return;
    }
    const oauthSucceeded = oauthResult === "success";
    if (oauthHandled.current || (!recoveryToken && !oauthSucceeded)) return;
    oauthHandled.current = true;
    setPending(true);
    setError("");
    void (recoveryToken ? recoverHubProfile(recoveryToken) : finishHubAccountLogin())
      .then(() => {
        if (recoveryToken) window.history.replaceState(null, "", window.location.pathname + window.location.search);
        router.replace(safeReturnTo);
        router.refresh();
      })
      .catch((caught) => {
        const code = caught instanceof Error ? caught.message : "";
        if (code === "profile_details_required") {
          setMode("signup");
          setProfileOnly(true);
          setSessionNotice("本人確認は完了しています。Hubで使う表示名とユーザーIDを決めてください。");
        } else if (code === "profile_recovery_expired" || code === "profile_already_linked") {
          setError("プロフィール復旧リンクは期限切れか、すでに使用されています。");
        } else {
          setError("Googleログイン後のHubプロフィール連携を完了できませんでした。もう一度お試しください。");
        }
      })
      .finally(() => setPending(false));
  }, [router, safeReturnTo]);

  async function finishHubLogin(profile?: { handle: string; displayName: string }) {
    await finishHubAccountLogin(profile);
  }

  const addAccountPasskey = async () => {
    if (!accountAuthenticated || checkingSession || sessionCheckFailed || pending || supported !== true) return;
    setPending(true);
    setError("");
    setPasskeyNotice("");
    setPasskeyAddError("");
    try {
      const begin = await accountRequest("/passkeys/register/options", {
        method: "POST", body: JSON.stringify({ addPasskey: true }),
      });
      const credential = await withPasskeyTimeout(startRegistration({
        optionsJSON: braveCompatibleRegistrationOptions(begin),
      }));
      const result = await accountRequest("/passkeys/register/verify", {
        method: "POST", body: JSON.stringify(credential),
      });
      if (result.passkeyAdded !== true) throw new Error("passkey_add_unconfirmed");
      setPasskeyNotice("このAccountに新しいパスキーを追加しました。");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setPasskeyAddError(code === "recent_authentication_required" || code === "unauthorized"
        ? "新しいパスキーを追加するには、GoogleなどでAccountにもう一度ログインしてください。"
        : code === "passkey_add_unconfirmed"
          ? "パスキーの追加結果を確認できませんでした。"
          : passkeyError(caught));
    } finally {
      setPending(false);
    }
  };

  const canContinueAccount = accountAuthenticated && !externalLoginFailure && !reauthenticate && recoveryStage === "code" && mode === "login";
  const needsPasskey = reauthenticate || recoveryStage !== "code" || (!canContinueAccount && !(mode === "signup" && profileOnly));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (needsPasskey && supported !== true) return setError("このブラウザーではパスキーを利用できません。対応する端末またはブラウザーで開いてください。");
    if (sessionCheckFailed) return setError("先に認証状態を再確認してください。");
    const normalizedHandle = handle.trim();
    const normalizedDisplayName = displayName.trim();
    if (mode === "signup" && !HANDLE_PATTERN.test(normalizedHandle)) return setError("ユーザーIDは3〜32文字の英数字と _ で入力してください。");
    if (mode === "signup" && !normalizedDisplayName) return setError("表示名を入力してください。");
    if (mode === "signup" && !acceptedTerms) return setError("利用規約とプライバシーポリシーへの同意が必要です。");
    if (mode === "signup" && !confirmedMinimumAge) return setError(`${HUB_MINIMUM_AGE}歳以上であることの確認が必要です。`);

    setPending(true);
    setError("");
    try {
      if (canContinueAccount) {
        await finishHubLogin();
        router.replace(safeReturnTo);
      } else if (mode === "signup") {
        if (reauthenticate) throw new Error("reauthentication_requires_existing_account");
        if (!profileOnly) {
          const begin = await accountRequest("/passkeys/register/options", {
            method: "POST", body: JSON.stringify({ displayName: normalizedDisplayName })
          });
          const credential = await withPasskeyTimeout(startRegistration({
            optionsJSON: braveCompatibleRegistrationOptions(begin)
          }));
          const registered = await accountRequest("/passkeys/register/verify", {
            method: "POST", body: JSON.stringify(credential)
          });
          setAccountAuthenticated(true);
          if (Array.isArray(registered.recoveryCodes)) {
            setRecoveryCodes(registered.recoveryCodes.filter((code): code is string => typeof code === "string"));
            return;
          }
        }
        await finishHubLogin({ handle: normalizedHandle, displayName: normalizedDisplayName });
        rememberRecoveryStage("code");
        router.replace(onboardingHref);
      } else {
        const begin = await accountRequest("/passkeys/authenticate/options", { method: "POST", body: "{}" });
        const credential = await withPasskeyTimeout(startAuthentication({
          optionsJSON: begin.options as PublicKeyCredentialRequestOptionsJSON
        }));
        await accountRequest("/passkeys/authenticate/verify", {
          method: "POST", body: JSON.stringify(credential)
        });
        setAccountAuthenticated(true);
        await finishHubLogin();
        rememberRecoveryStage("code");
        router.replace(safeReturnTo);
      }
      router.refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      if (code === "profile_details_required" && reauthenticate) {
        setError("再認証するHubプロフィールを確認できませんでした。元の画面へ戻り、もう一度お試しください。");
      } else if (code === "profile_details_required") {
        setMode("signup");
        setProfileOnly(true);
        setSessionNotice("本人確認は完了しています。Hubで使う表示名とユーザーIDを決めてください。");
      } else if (canContinueAccount && (code === "recent_authentication_required" || code === "account_login_required" || code === "unauthorized")) {
        setAccountAuthenticated(false);
        setError("ログインの有効期限が切れています。もう一度ログインしてください。");
      } else if (code === "passkey_invalid") {
        setShowLegacy(true);
        setHelpOpen(true);
        setError("共通Accountはまだ作成されていません。以前のHubユーザーIDを入力して、プロフィールを移行してください。");
      } else if (mode === "login" && hasLegacyProfile && caught instanceof Error && caught.name === "NotAllowedError") {
        setMode("signup");
        setError("この端末には共通パスキーがまだありません。下の「共通パスキーを作成」から作成してください。");
      } else if (code === "passkey_timeout") {
        setError("端末の確認画面から応答がありませんでした。ブラウザの前面に確認画面がないか確認して、もう一度お試しください。");
      } else if (code === "invalid_assertion" || code === "assertion_replayed") {
        setError("Accountの認証票を確認できませんでした。画面を再読み込みして、もう一度連携してください。");
      } else if (code === "account_already_linked" || code === "handle_unavailable") {
        setError("このAccountまたはHubユーザーIDは、すでに別のプロフィールへ連携されています。");
      } else if (code === "auth_request_timeout") {
        setError("Accountからの応答が時間切れになりました。通信状態を確認して、もう一度お試しください。");
      } else if (code === "reauthentication_requires_existing_account") {
        setError("再認証では新しいAccountを作成できません。登録済みのパスキーで本人確認してください。");
      } else {
        setError(code && /^[a-z_]+$/u.test(code) ? "Accountへログインできませんでした。" : passkeyError(caught));
      }
    } finally {
      setPending(false);
    }
  };

  const continueAfterRecoveryCodes = async () => {
    if (!recoverySaved) return;
    setPending(true);
    setError("");
    try {
      await finishHubLogin({ handle: handle.trim(), displayName: displayName.trim() });
      router.replace(onboardingHref);
      router.refresh();
    } catch (caught) {
      setError(passkeyError(caught));
    } finally {
      setPending(false);
    }
  };

  const recoverWithCode = async () => {
    if (recoveryStage !== "hub-link" && supported !== true) {
      setError("このブラウザーでは新しいパスキーを作成できません。復旧コードは入力せず、対応する端末またはブラウザーで開いてください。");
      return;
    }
    if (recoveryStage === "code" && !recoveryCode.trim()) {
      setError("未使用の復旧コードを入力してください。");
      return;
    }
    setPending(true);
    setError("");
    let stage = recoveryStage;
    try {
      if (stage === "code") {
        await accountRequest("/recovery/verify", {
          method: "POST",
          body: JSON.stringify({ code: recoveryCode.trim() })
        });
        stage = "passkey";
        rememberRecoveryStage(stage);
        setRecoveryCode("");
      }
      if (stage === "passkey") {
        const begin = await accountRequest("/passkeys/register/options", {
          method: "POST",
          body: JSON.stringify({ addPasskey: true })
        });
        const credential = await withPasskeyTimeout(startRegistration({
          optionsJSON: braveCompatibleRegistrationOptions(begin)
        }));
        await accountRequest("/passkeys/register/verify", {
          method: "POST",
          body: JSON.stringify(credential)
        });
        stage = "hub-link";
        rememberRecoveryStage(stage);
      }
      await finishHubLogin();
      rememberRecoveryStage("code");
      router.replace(safeReturnTo);
      router.refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      if (
        stage !== "code"
        && (
          code === "account_login_required"
          || code === "unauthorized"
          || code === "recent_authentication_required"
        )
      ) {
        rememberRecoveryStage("code");
        setRecoveryCode("");
        setError("復旧セッションの有効時間が終了しました。別の未使用コードを使って、最初から復旧してください。");
      } else if (code === "recovery_failed") {
        setError("復旧コードを確認できませんでした。未使用のコードを入力してください。");
      } else if (stage === "hub-link") {
        setError(code === "auth_request_timeout"
          ? "新しいパスキーは作成済みです。Accountの応答が時間切れになりました。Hubとの連携だけを再試行してください。"
          : "新しいパスキーは作成済みです。Hubとの連携だけをもう一度お試しください。");
      } else if (stage === "passkey") {
        setError(code === "auth_request_timeout"
          ? "復旧コードは確認済みです。Accountの応答が時間切れになりました。コードを再検証せず、パスキー作成を再開できます。"
          : `${passkeyError(caught)} 復旧コードは確認済みのため、次回はコードを再検証せずパスキー作成から再開します。`);
      } else {
        setError(passkeyError(caught));
      }
    } finally {
      setPending(false);
    }
  };

  const legacyLogin = async () => {
    const normalizedHandle = handle.trim();
    if (!HANDLE_PATTERN.test(normalizedHandle)) return setError("以前のHubユーザーIDを入力してください。");
    setPending(true);
    setError("");
    try {
      const beginResponse = await fetchAuthRequest("/api/auth/passkey/authenticate/options", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: normalizedHandle })
      });
      const begin = await beginResponse.json() as { options?: PublicKeyCredentialRequestOptionsJSON; error?: string };
      if (!beginResponse.ok || !begin.options) throw new Error(begin.error ?? "legacy_login_failed");
      const credential = await withPasskeyTimeout(startAuthentication({ optionsJSON: begin.options }));
      const verified = await fetchAuthRequest("/api/auth/passkey/authenticate/verify", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credential)
      });
      if (!verified.ok) throw new Error("legacy_login_failed");
      setMode("signup");
      setProfileOnly(false);
      setError("以前のHubプロフィールを確認しました。表示名を入力し、共通パスキーを1個作成してください。");
      setShowLegacy(false);
    } catch (caught) {
      setError(passkeyError(caught));
    } finally {
      setPending(false);
    }
  };

  const recoverySessionEstablished = recoveryStage !== "code";
  const recoveryActionLabel = recoveryStage === "code"
    ? "復旧して新しいパスキーを作る"
    : recoveryStage === "passkey"
      ? "新しいパスキーの作成を再開"
      : "Hubとの連携を完了";
  const recoveryPendingLabel = recoveryStage === "hub-link"
    ? "Hubと連携中…"
    : "復旧中…";

  if (recoveryCodes.length > 0) {
    return (
      <div className="hub-auth-panel hub-auth-recovery">
        <h2>復旧コードを保存</h2>
        <p>パスキーを使えなくなったときに必要です。この画面を閉じると再表示できません。</p>
        <ul className="hub-auth-recovery-codes" aria-label="復旧コード">
          {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
        </ul>
        <UiButton type="button" size="compact" onClick={() => {
          void navigator.clipboard?.writeText(recoveryCodes.join("\n")).catch(() => undefined);
        }}>すべてコピー</UiButton>
        <label className="hub-auth-terms">
          <input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} />
          <span>復旧コードを安全な場所へ保存しました</span>
        </label>
        {error && <p className="hub-auth-error" role="status">{error}</p>}
        <AsyncActionButton type="button" pending={pending} pendingLabel="連携中…" disabled={!recoverySaved} onClick={continueAfterRecoveryCodes}>
          Hubを始める
        </AsyncActionButton>
      </div>
    );
  }

  const preferExternalLogin = !canContinueAccount && !profileOnly && mode === "login"
    && !reauthenticate && recoveryStage === "code" && !recoveryOpen && !pending
    && !error && (oauthProviders.google || oauthProviders.apple);
  const authForm = (
      <form className="hub-auth-form" onSubmit={submit} noValidate>
      {supported === false && needsPasskey ? (
        <p className="hub-auth-error" role="alert">
          {recoveryStage === "hub-link"
            ? "このブラウザーではパスキーを利用できませんが、新しいパスキーは作成済みです。Hubとの連携だけはこのまま完了できます。"
            : oauthProviders.google || oauthProviders.apple
              ? "このブラウザーではパスキーを利用できません。表示されているGoogleまたはAppleのボタンから続けられます。"
              : "このブラウザーではパスキーを利用できないため、ログイン・新規登録・Account復旧を完了できません。パスキー対応の端末またはブラウザーでこのページを開いてください。復旧コードは入力しないでください。"}
          {" "}<a href="https://jkamma.com/#contact">問い合わせ窓口へ</a>
        </p>
      ) : null}
        {mode === "signup" && <>
          <label><span>表示名</span><UiInput value={displayName} onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="nickname" maxLength={80} required disabled={pending} /></label>
          <label><span>HubユーザーID</span><UiInput value={handle} onChange={(event) => setHandle(event.target.value)}
            autoComplete="username" minLength={3} maxLength={32} spellCheck={false} required disabled={pending} />
            <small>3〜32文字の英数字と _</small></label>
          <label className="hub-auth-terms"><input type="checkbox" checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)} disabled={pending} />
            <span><a href={hubSurfacePath(surface, "/terms")}>利用規約</a>と<a href={hubSurfacePath(surface, "/privacy")}>プライバシーポリシー</a>に同意します。</span></label>
          <label className="hub-auth-terms"><input type="checkbox" checked={confirmedMinimumAge}
            onChange={(event) => setConfirmedMinimumAge(event.target.checked)} disabled={pending} data-hub-age-confirmation />
            <span>{HUB_MINIMUM_AGE}歳以上です。生年月日は集めません。</span></label>
        </>}
        {error && <p className="hub-auth-error" role="alert">{error}</p>}
        {sessionCheckFailed ? (
          <UiButton
            type="button"
            onClick={() => void checkSession()}
            disabled={checkingSession}
          >
            認証状態を再確認
          </UiButton>
        ) : null}
        <AsyncActionButton className="hub-auth-submit" type="submit"
          disabled={(needsPasskey && supported !== true) || checkingSession || sessionCheckFailed}
          pending={pending || checkingSession} pendingLabel={checkingSession ? "認証状態を確認中…" : "端末で確認中…"}>
          {canContinueAccount ? "Hubで続ける" : mode === "signup" ? (profileOnly ? "プロフィールを保存して続ける" : "アカウントを作成") : "ログイン"}
        </AsyncActionButton>
        {!checkingSession && !sessionCheckFailed && needsPasskey && supported === true ? (
          <div className="hub-auth-login-guide">
            <small>次に開く端末の確認画面で、PIN・指紋・顔認証などを使って進めます。</small>
            <details className="hub-auth-more">
              <summary>確認画面で迷ったとき</summary>
              <p>{mode === "signup"
                ? "パスキーの保存先を選ぶ画面が出たら、この端末や普段使っているパスキーマネージャーを選び、画面の案内に従って保存します。"
                : "ログイン方法を選ぶ画面が出たら、登録時に保存した端末やパスキーマネージャーを選びます。Windows Helloを選んだ場合は、Windowsで普段使っているPIN・顔・指紋で確認します。"}</p>
              <p>確認画面を閉じてもアカウントは消えません。もう一度ボタンを押してやり直せます。</p>
            </details>
          </div>
        ) : null}
        {pending && <UiButton type="button" className="hub-auth-legacy-toggle" onClick={() => {
          WebAuthnAbortService.cancelCeremony();
          setPending(false);
          setError("端末での確認をキャンセルしました。もう一度お試しください。");
        }}>キャンセルしてやり直す</UiButton>}
      </form>
  );

  return (
    <div className="hub-auth-panel">
      {reauthenticate ? (
        <p className="hub-auth-passkey-help" role="status">
          再認証モードです。新しいAccountは作成せず、登録済みの共通パスキーで本人確認します。
        </p>
      ) : (
        <div className="hub-auth-tabs" role="tablist" aria-label="認証方法">
          <UiButton size="compact" type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : undefined}
            disabled={checkingSession || sessionCheckFailed}
            onClick={() => { setMode("login"); setError(""); }}>ログイン</UiButton>
          <UiButton size="compact" type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : undefined}
            disabled={checkingSession || sessionCheckFailed}
            onClick={() => { setMode("signup"); setError(""); }}>新規登録</UiButton>
        </div>
      )}
      {sessionNotice ? <p className="hub-auth-passkey-help" role="status">{sessionNotice}</p> : null}
      {externalLoginFailure ? <p className="hub-auth-error" role="alert">
        {externalLoginFailure === "conflict"
          ? "そのログイン方法は別のアカウントで使われています。登録時のアカウントを選び直してください。"
          : "ログインを完了できませんでした。もう一度ログインを選んでください。"}
      </p> : null}
      {!canContinueAccount && !profileOnly && (oauthProviders.google || oauthProviders.apple) ? (
        <div className="hub-auth-oauth" aria-label="外部アカウントでログイン">
          {oauthProviders.google ? <a href={`${ACCOUNT}/oauth/google/start?return_to=${encodeURIComponent(`/auth?next=${encodeURIComponent(safeReturnTo)}`)}`}>Googleでログイン</a> : null}
          {oauthProviders.apple ? <a href={`${ACCOUNT}/oauth/apple/start?return_to=${encodeURIComponent(`/auth?next=${encodeURIComponent(safeReturnTo)}`)}`}>Appleでログイン</a> : null}
          <p>ログイン元のメールアドレスはHubへ共有されません。</p>
          <span aria-hidden="true">または</span>
        </div>
      ) : null}
      {preferExternalLogin ? (
        <details className="hub-auth-more hub-auth-device-method">
          <summary>PIN・指紋などでログイン</summary>
          {authForm}
        </details>
      ) : authForm}
      {accountAuthenticated && !reauthenticate && !checkingSession && !sessionCheckFailed && !recoverySessionEstablished ? (
        <details className="hub-auth-more">
          <summary>この端末にパスキーを追加する</summary>
          <section className="hub-auth-form" aria-label="Accountのパスキー">
            <AsyncActionButton type="button" pending={pending} pendingLabel="端末で確認中…"
              disabled={pending || supported !== true} onClick={addAccountPasskey}>
              Accountに新しいパスキーを追加
            </AsyncActionButton>
            {passkeyAddError && <p className="hub-auth-error" role="alert">{passkeyAddError}</p>}
            <small>ログイン中のAccountに、Windows Helloなどの新しいパスキーを追加できます。</small>
            {passkeyNotice && <p role="status">{passkeyNotice}</p>}
          </section>
        </details>
      ) : null}
      {mode === "login" && !canContinueAccount && !profileOnly && !accountAuthenticated ? (
        <WalletSignInButton disabled={checkingSession || sessionCheckFailed} onSignedIn={async () => {
          setAccountAuthenticated(true);
          await finishHubLogin();
          rememberRecoveryStage("code");
          router.replace(safeReturnTo);
          router.refresh();
        }} />
      ) : null}
      {accountAuthenticated && !reauthenticate && !checkingSession && !sessionCheckFailed && !recoverySessionEstablished ? (
        <details className="hub-auth-more">
          <summary>ウォレットでのログインを管理する</summary>
          <AccountWalletList />
        </details>
      ) : null}
      <details className="hub-auth-more hub-auth-login-help" open={helpOpen}
        onToggle={(event) => setHelpOpen(event.currentTarget.open)}>
        <summary>ログインできないとき</summary>
      {!reauthenticate ? (
        <UiButton type="button" className="hub-auth-legacy-toggle"
          disabled={checkingSession || sessionCheckFailed || supported !== true}
          onClick={() => { setHelpOpen(true); setShowLegacy((value) => !value); }}>
          以前のHubパスキーを移行
        </UiButton>
      ) : null}
      <UiButton type="button" className="hub-auth-legacy-toggle" onClick={() => { setHelpOpen(true); setRecoveryOpen((value) => !value); }}>
        {recoverySessionEstablished ? "Account復旧を続ける" : "パスキーを使えない場合"}
      </UiButton>
      {recoveryOpen && <div className="hub-auth-form">
        {recoveryStage === "code" ? (
          <label>
            <span>復旧コード</span>
            <UiInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)}
              autoComplete="one-time-code" spellCheck={false} disabled={pending || supported !== true} />
            <small>復旧すると、ほかの端末はすべてログアウトします。コードは新しいパスキー作成を始める直前に一度だけ確認します。</small>
          </label>
        ) : (
          <p className="hub-auth-passkey-help" role="status">
            {recoveryStage === "passkey"
              ? "復旧コードは確認済みです。再試行してもコードを再検証せず、新しいパスキーの作成から再開します。"
              : "新しいパスキーは作成済みです。支払い情報などを共有せず、Hub専用の匿名識別子との連携だけを完了します。"}
          </p>
        )}
        <AsyncActionButton
          type="button"
          pending={pending}
          pendingLabel={recoveryPendingLabel}
          disabled={
            checkingSession
            || sessionCheckFailed
            || (recoveryStage !== "hub-link" && supported !== true)
            || (recoveryStage === "code" && !recoveryCode.trim())
          }
          onClick={recoverWithCode}
        >
          {recoveryActionLabel}
        </AsyncActionButton>
      </div>}
      {!reauthenticate && showLegacy && <div className="hub-auth-form">
        <label><span>以前のHubユーザーID</span><UiInput value={handle}
          onChange={(event) => setHandle(event.target.value)} autoComplete="username"
          disabled={pending || supported !== true} /></label>
        <AsyncActionButton type="button" pending={pending} pendingLabel="確認中…"
          disabled={supported !== true} onClick={legacyLogin}>
          以前のプロフィールを確認
        </AsyncActionButton>
        <small>移行後は共通AccountのパスキーだけでHubへログインできます。古いパスキーは端末の設定から削除できます。</small>
      </div>}
      </details>
    </div>
  );
}
