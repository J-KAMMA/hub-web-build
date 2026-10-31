/*
 * 広告（AdSense）の同意の保存（2026-10-14、所有者承認）。
 *
 * 広告は、同意の前には読み込まない（スクリプトも、広告用の Cookie も）。
 * 選びは端末の localStorage の hub.ad_consent に、"granted" か "denied" で残す。
 * 未選択は「同意なし」と同じに扱う。Domain=.jkamma.com の Cookie は使わない。
 *
 * これは最小の同意画面で、Google 認定の CMP（IAB TCF）ではない。欧州経済領域・英国・
 * スイスの訪問者へ AdSense の広告を出す前に、認定 CMP を設定しなければならない
 * （docs/hub-international/AD_CONSENT.md）。
 */
export const AD_CONSENT_KEY = "hub.ad_consent";
export const AD_CONSENT_EVENT = "hub:ad-consent";

export type AdConsentChoice = "granted" | "denied";
export type AdConsentState = AdConsentChoice | "unset";

export function readAdConsent(): AdConsentState {
  try {
    const value = window.localStorage.getItem(AD_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "unset";
  } catch {
    return "unset";
  }
}

/*
 * 選びを保存して、同じ画面の他の広告枠へ知らせる。
 * 同意を取り消したときは、すでに読み込んだ広告のスクリプトを消すため、頁を読み込み直す。
 */
export function writeAdConsent(choice: AdConsentChoice | "unset"): void {
  const before = readAdConsent();
  try {
    if (choice === "unset") window.localStorage.removeItem(AD_CONSENT_KEY);
    else window.localStorage.setItem(AD_CONSENT_KEY, choice);
  } catch {
    /* 保存できなくても、この頁の中では選びが効く（同意は保存できた時だけ次の頁へ残る）。 */
  }
  window.dispatchEvent(new Event(AD_CONSENT_EVENT));
  if (before === "granted" && choice !== "granted") window.location.reload();
}
