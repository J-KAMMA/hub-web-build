"use client";

import { useEffect, useState } from "react";

import {
  clearHubInterestProfile,
  HUB_INTEREST_PROFILE_CHANGED_EVENT,
  HUB_PERSONALIZATION_KEY,
  hubPersonalizationEnabled,
  readHubInterestProfile,
  topHubInterests,
} from "@/lib/hub-interest-profile";
import { hubAdPersonalizationEnabled, setHubAdPersonalizationEnabled } from "@/lib/hub-ad-personalization";
import { POST_HISTORY_KEY } from "@/lib/post-personalization";
import { VIDEO_HISTORY_KEY } from "@/lib/video-personalization";
import { readDiscoveryHidden, resetDiscoveryFeedback, setDiscoveryHidden, DISCOVERY_FEEDBACK_EVENT } from "@/lib/discovery-feedback";
import {
  HUB_RANKING_PREFERENCES,
  readHubRankingPreference,
  setHubRankingPreference,
  type HubRankingPreference,
} from "@/lib/hub-ranking-preference";

export function HubPersonalizationSettings() {
  const [feedbackReset, setFeedbackReset] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [interests, setInterests] = useState<string[]>([]);
  const [adPersonalization, setAdPersonalization] = useState(true);
  const [rankingPreference, setRankingPreference] =
    useState<HubRankingPreference>("balanced");
  const [authorAdjustments, setAuthorAdjustments] = useState<{ key: string; surface: string; author: string }[]>([]);

  useEffect(() => {
    const sync = () => {
      try {
        const nextEnabled = hubPersonalizationEnabled();
        const nextInterests = topHubInterests(readHubInterestProfile(), 6);
        const nextAds = hubAdPersonalizationEnabled();
        const nextRanking = readHubRankingPreference();
        const nextAuthors = readDiscoveryHidden(window.localStorage, true)
          .flatMap((key) => {
            const match = /^([^:]+):author:(.*)$/.exec(key);
            return match ? [{ key, surface: match[1], author: match[2] }] : [];
          });
        setEnabled(nextEnabled);
        setInterests(nextInterests);
        setAdPersonalization(nextAds);
        setRankingPreference(nextRanking);
        setAuthorAdjustments(nextAuthors);
      } catch { setFeedbackReset("設定を読み込めませんでした。ブラウザの保存設定を確認して再読み込みしてください。"); }
    };
    sync();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
    window.addEventListener(DISCOVERY_FEEDBACK_EVENT, sync);
    return () => {
      window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
      window.removeEventListener(DISCOVERY_FEEDBACK_EVENT, sync);
    };
  }, []);

  const changeEnabled = (value: boolean) => {
    try {
      window.localStorage.setItem(HUB_PERSONALIZATION_KEY, value ? "on" : "off");
      setEnabled(value);
      setFeedbackReset("設定を保存しました。");
      window.dispatchEvent(new CustomEvent(HUB_INTEREST_PROFILE_CHANGED_EVENT));
    } catch { setFeedbackReset("設定を保存できませんでした。もう一度お試しください。"); }
  };

  const clear = () => {
    try {
    window.localStorage.removeItem(POST_HISTORY_KEY);
    window.localStorage.removeItem(VIDEO_HISTORY_KEY);
    clearHubInterestProfile();
    setInterests([]);
    setFeedbackReset("閲覧履歴と共通の関心を消去しました。");
    } catch { setFeedbackReset("すべての履歴と関心を消去できませんでした。一部だけ消去された可能性があります。もう一度お試しください。"); }
  };

  return <div className="settings-personalization">
    <label className="setting-row">
      <span><strong>おすすめをパーソナライズ</strong><small>Hub内の関心語を、フィード・動画・記事・本・ゲーム・マーケット・コミュニティ・Hubpediaで共有します</small></span>
      <input type="checkbox" checked={enabled} onChange={(event) => changeEnabled(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
    <label className="setting-row">
      <span><strong>おすすめの基準</strong><small>フィードや発見画面で共通して使う並び順です</small></span>
      <select
        value={rankingPreference}
        onChange={(event) => {
          const value = event.target.value as HubRankingPreference;
          try {
            setHubRankingPreference(value);
            setRankingPreference(value);
            setFeedbackReset("設定を保存しました。");
          } catch { setFeedbackReset("設定を保存できませんでした。もう一度お試しください。"); }
        }}
      >
        {HUB_RANKING_PREFERENCES.map((preference) => (
          <option key={preference.id} value={preference.id}>
            {preference.label} — {preference.description}
          </option>
        ))}
      </select>
    </label>
    <label className="setting-row">
      <span><strong>広告もパーソナライズ</strong><small>共通の関心語を、Hubが配信する直接スポンサー広告の選択にも使用します</small></span>
      <input type="checkbox" checked={adPersonalization} disabled={!enabled} onChange={(event) => {
        try {
          setHubAdPersonalizationEnabled(event.target.checked);
          setAdPersonalization(event.target.checked);
          setFeedbackReset("設定を保存しました。");
        } catch { setFeedbackReset("設定を保存できませんでした。もう一度お試しください。"); }
      }} />
      <i aria-hidden="true" />
    </label>
    <div className="settings-note">
      <strong>共通の関心</strong>
      <p>{interests.length ? interests.join("、") : "まだ関心データはありません。"}</p>
      <p>閲覧内容そのものではなく、集約した関心語だけをこのブラウザに保存します。Musicの履歴は共有しません。</p>
    </div>
    <button className="button hub-personalization__reset" type="button" onClick={clear}>閲覧履歴と共通の関心を消去</button>
    <button className="button hub-personalization__reset" type="button" onClick={() => {
      try {
        resetDiscoveryFeedback("items", window.localStorage);
        window.dispatchEvent(new Event(DISCOVERY_FEEDBACK_EVENT));
        setFeedbackReset("おすすめの非表示をリセットしました。");
      } catch { setFeedbackReset("リセットできませんでした。もう一度お試しください。"); }
    }}>おすすめの非表示をリセット</button>
    <button className="button hub-personalization__reset" type="button" onClick={() => {
      try {
        resetDiscoveryFeedback("authors", window.localStorage);
        setAuthorAdjustments([]);
        window.dispatchEvent(new Event(DISCOVERY_FEEDBACK_EVENT));
        setFeedbackReset("作者のおすすめ順位の調整をリセットしました。");
      } catch { setFeedbackReset("リセットできませんでした。もう一度お試しください。"); }
    }}>作者のおすすめ順位をリセット</button>
    {authorAdjustments.length ? <div className="settings-note" aria-label="作者ごとのおすすめ設定">
      <strong>作者ごとのおすすめ設定</strong>
      <ul>
        {authorAdjustments.map(({ key, surface, author }) => <li key={key}>
          <span>{surface} · {author}</span>
          <button className="button hub-personalization__reset" type="button" onClick={() => {
            try {
              setDiscoveryHidden(key, false, window.localStorage);
              setAuthorAdjustments(current => current.filter(item => item.key !== key));
              window.dispatchEvent(new Event(DISCOVERY_FEEDBACK_EVENT));
              setFeedbackReset("作者のおすすめ順位を元に戻しました。");
            } catch { setFeedbackReset("元に戻せませんでした。もう一度お試しください。"); }
          }}>この作者を元に戻す</button>
        </li>)}
      </ul>
    </div> : null}
    <p className="settings-note">非表示と作者の順位調整は、このブラウザに保存されます。それぞれ別にリセットできます。</p>
    {feedbackReset ? <p role="status">{feedbackReset}</p> : null}
  </div>;
}
