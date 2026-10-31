/*
 * 規約・プライバシーポリシーの現行の版と、利用できる最低年齢（2026-10-14、所有者承認）。
 *
 * ここが正本。文面（components/hub-terms.tsx、components/hub-privacy.tsx）を
 * 実質的に変えたら、日付を新しくする。登録時にここの値が hub_consent_records へ
 * 写される。
 */
export const HUB_TERMS_VERSION = "2026-10-14";
export const HUB_PRIVACY_VERSION = "2026-10-14";
export const HUB_MINIMUM_AGE = 16;

export type HubConsentSource = "passkey_signup" | "account_signup";

export type HubConsentRecord = {
  termsVersion: string;
  privacyVersion: string;
  minimumAgeConfirmed: number;
  source: HubConsentSource;
  consentedAt: string;
};

/*
 * 登録の要求が、規約への同意と16歳以上の確認を両方 true で渡しているか。
 * true 以外（文字列 "true"、1、未指定）は認めない。
 */
export function hasSignupConsent(body: { acceptedTerms?: unknown; confirmedMinimumAge?: unknown } | null | undefined): boolean {
  return body?.acceptedTerms === true && body?.confirmedMinimumAge === true;
}
