import React from "react";

import { HubConsentChoices } from "@/components/hub-consent-choices";
import { HUB_MINIMUM_AGE, HUB_PRIVACY_VERSION, HUB_TERMS_VERSION } from "@/lib/hub-consent";
import { listConsentRecords } from "@/lib/server/hub-consent-records";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

/* 登録のときに同意した規約・ポリシーの版と日時（2026-10-14）。既存の利用者には記録が無い。 */
export async function V2SettingsConsent({ profileId, japanese }: { profileId: string; japanese: boolean }) {
  const database = getOptionalHubD1();
  const records = database ? await listConsentRecords(database, profileId) : [];
  return (
    <div className="v2-settings-consent">
      <p className="v2-note">
        {japanese
          ? `現行の版: 利用規約 ${HUB_TERMS_VERSION}、プライバシーポリシー ${HUB_PRIVACY_VERSION}。利用は${HUB_MINIMUM_AGE}歳以上です。`
          : `Current versions: Terms ${HUB_TERMS_VERSION}, Privacy Policy ${HUB_PRIVACY_VERSION}. You must be ${HUB_MINIMUM_AGE} or older.`}
      </p>
      {records.length === 0 ? (
        <p className="v2-note">{japanese ? "登録時の同意の記録はありません（この記録を始める前に登録したアカウントです）。" : "No sign-up consent record (this account predates records)."}</p>
      ) : (
        <ul className="v2-settings-consent__list">
          {records.map((record) => (
            <li key={`${record.consentedAt}-${record.source}`}>
              <time dateTime={record.consentedAt}>{record.consentedAt.slice(0, 16).replace("T", " ")} UTC</time>
              {japanese
                ? ` 規約 ${record.termsVersion}・ポリシー ${record.privacyVersion}・${record.minimumAgeConfirmed}歳以上を確認`
                : ` Terms ${record.termsVersion}, Privacy ${record.privacyVersion}, age ${record.minimumAgeConfirmed}+ confirmed`}
            </li>
          ))}
        </ul>
      )}
      <HubConsentChoices />
    </div>
  );
}
