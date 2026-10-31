"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LanguageSelector } from "@/components/language-selector";
import { SettingsDirectory } from "@/components/settings-directory";
import { RegionSelector } from "@/components/region-selector";
import { HubAccountControls } from "@/components/hub-account-controls";
import { HubPersonalizationSettings } from "@/components/hub-personalization-settings";
import { NotificationSettings } from "@/components/notification-settings";
import { ContentSafetySettings } from "@/components/content-safety-settings";
import { ProfileSafetySettings } from "@/components/profile-safety-settings";
import { ScheduledPostManager } from "@/components/scheduled-post-manager";
import { AccountStoragePanel } from "@/components/account-storage-panel";
import { ExternalProtocolSettings } from "@/components/external-protocol-settings";
import { DataPortabilityCenter } from "@/components/data-portability-center";
import { FederationSettings } from "@/components/federation-settings";
import { DomainAliasSettings } from "@/components/domain-alias-settings";
import { DistributedNetworkSettings } from "@/components/distributed-network-settings";
import { PersonalNodeSettings } from "@/components/personal-node-settings";
import { AgentAccessSettings } from "@/components/agent-access-settings";
import type { HubRegion } from "@/lib/hub-region";
import type { HubLocale } from "@/lib/i18n";
import { hubUi } from "@/lib/ui-copy";
import { TranslationLanguageSettings } from "@/components/translation-language-settings";
import { UiButton, UiSelect } from "@/components/ui/primitives";

type ToggleProps = {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

type Theme = "auto" | "dark" | "light";
type ResolvedTheme = "dark" | "light";
type Accent = "blue" | "purple" | "pink" | "orange" | "green" | "graphite";
type TextSize = "standard" | "large";
type FeedDensity = "standard" | "compact" | "media";

const preferenceKeys = [
  "hub.compact",
  "hub.theme",
  "hub.accent",
  "hub.palette",
  "hub.text-size",
  "hub.reduce-motion",
  "hub.right-open",
  "hub.feed-density",
  "hub.left-width",
  "hub.right-width",
] as const;

export function clearStoredDisplayPreferences(storage: Pick<Storage, "removeItem">) {
  preferenceKeys.forEach((key) => storage.removeItem(key));
}

function Toggle({ label, description, value, onChange, disabled = false }: ToggleProps) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function applyPreference(name: string, value: string) {
  localStorage.setItem(name, value);
}

function systemPrefersDark() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function SettingsPanel({ profileHandle, locale, region }: { profileHandle: string; locale: HubLocale; region: HubRegion }) {
  const copy = hubUi(locale).settings;
  const ja = locale === "ja";
  const [theme, setTheme] = useState<Theme>("auto");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");
  const [accent, setAccent] = useState<Accent>("blue");
  const [palette, setPalette] = useState<"default" | "gold-ivory">("default");
  const [textSize, setTextSize] = useState<TextSize>("standard");
  const [compact, setCompact] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [feedDensity, setFeedDensity] = useState<FeedDensity>("standard");
  const [saved, setSaved] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("hub.theme");
    const preference: Theme = savedTheme === "light" || savedTheme === "auto" ? savedTheme : "dark";
    const resolved = preference === "auto"
      ? systemPrefersDark() ? "dark" : "light"
      : preference;
    setTheme(preference);
    setResolvedTheme(resolved);
    setPalette(localStorage.getItem("hub.palette") === "default" ? "default" : "gold-ivory");
    const savedAccent = localStorage.getItem("hub.accent");
    setAccent(
      savedAccent === "purple" ||
        savedAccent === "pink" ||
        savedAccent === "orange" ||
        savedAccent === "green" ||
        savedAccent === "graphite"
        ? savedAccent
        : "blue",
    );
    setTextSize(localStorage.getItem("hub.text-size") === "large" ? "large" : "standard");
    setCompact(localStorage.getItem("hub.compact") === "true");
    setReduceMotion(localStorage.getItem("hub.reduce-motion") === "true");
    setRightOpen(localStorage.getItem("hub.right-open") !== "false");
    const storedDensity = localStorage.getItem("hub.feed-density");
    setFeedDensity(storedDensity === "compact" || storedDensity === "media" ? storedDensity : "standard");
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (theme !== "auto") return;
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const resolved: ResolvedTheme = media.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      document.documentElement.dataset.theme = resolved;
      window.dispatchEvent(new CustomEvent("hub:theme-change", { detail: resolved }));
    };
    syncTheme();
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, [preferencesLoaded, theme]);

  const confirmSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const changeTheme = (value: Theme) => {
    const resolved: ResolvedTheme = value === "auto"
      ? systemPrefersDark() ? "dark" : "light"
      : value;
    setTheme(value);
    setResolvedTheme(resolved);
    applyPreference("hub.theme", value);
    document.documentElement.dataset.theme = resolved;
    window.dispatchEvent(new CustomEvent("hub:theme-change", { detail: resolved }));
    confirmSaved();
  };

  const changeTextSize = (value: TextSize) => {
    setTextSize(value);
    applyPreference("hub.text-size", value);
    document.documentElement.dataset.textSize = value;
    confirmSaved();
  };

  const changePalette = (value: "default" | "gold-ivory") => {
    setPalette(value);
    if (value === "gold-ivory") {
      applyPreference("hub.palette", value);
      document.documentElement.dataset.palette = value;
    } else {
      try { localStorage.setItem("hub.palette", "default"); } catch { /* 端末に書けなくても続ける */ }
      delete document.documentElement.dataset.palette;
    }
    confirmSaved();
  };

  const changeAccent = (value: Accent) => {
    setAccent(value);
    applyPreference("hub.accent", value);
    document.documentElement.dataset.accent = value;
    confirmSaved();
  };

  const compactChange = (value: boolean) => {
    setCompact(value);
    applyPreference("hub.compact", String(value));
    document.documentElement.dataset.compact = String(value);
    confirmSaved();
  };

  const motionChange = (value: boolean) => {
    setReduceMotion(value);
    applyPreference("hub.reduce-motion", String(value));
    document.documentElement.dataset.reduceMotion = String(value);
    confirmSaved();
  };

  const rightRailChange = (value: boolean) => {
    setRightOpen(value);
    applyPreference("hub.right-open", String(value));
    window.dispatchEvent(new CustomEvent("hub:right-open-change", { detail: value }));
    confirmSaved();
  };

  const feedDensityChange = (value: FeedDensity) => {
    setFeedDensity(value);
    applyPreference("hub.feed-density", value);
    document.documentElement.dataset.feedDensity = value;
    window.dispatchEvent(new CustomEvent("hub:feed-density-change", { detail: value }));
    confirmSaved();
  };

  const resetPreferences = () => {
    clearStoredDisplayPreferences(localStorage);
    const resolved: ResolvedTheme = systemPrefersDark() ? "dark" : "light";
    setTheme("auto");
    setResolvedTheme(resolved);
    setAccent("blue");
    setPalette("default");
    delete document.documentElement.dataset.palette;
    setTextSize("standard");
    setCompact(false);
    setReduceMotion(false);
    setRightOpen(true);
    setFeedDensity("standard");
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.accent = "gold";
    document.documentElement.dataset.textSize = "standard";
    document.documentElement.dataset.compact = "false";
    document.documentElement.dataset.reduceMotion = "false";
    document.documentElement.dataset.feedDensity = "standard";
    window.dispatchEvent(new CustomEvent("hub:theme-change", { detail: resolved }));
    window.dispatchEvent(new CustomEvent("hub:right-open-change", { detail: true }));
    window.dispatchEvent(new CustomEvent("hub:column-width-reset"));
    confirmSaved();
  };

  /*
   * Thirteen sections, named where people can see them. The hints double as
   * the filter's vocabulary, so a search for テーマ or Codex lands on the
   * right section without knowing what it is called here.
   */
  const basics = ja ? "基本" : "Basics";
  const posting = ja ? "投稿" : "Posting";
  const connections = ja ? "接続" : "Connections";
  const dataGroup = ja ? "データと端末" : "Data & device";
  const directorySections = [
    { group: basics, id: "account", label: copy.accountTitle, hint: ja ? "アカウント・おすすめ・コンテンツ安全" : "Account, recommendations, content safety" },
    { group: basics, id: "display", label: copy.displayTitle, hint: ja ? "テーマ・文字サイズ・言語・地域" : "Theme, text size, language, region" },
    { group: basics, id: "notifications", label: copy.notifications, hint: ja ? "通知の受け取り方" : "How notifications reach you" },
    { group: basics, id: "privacy", label: copy.privacy, hint: ja ? "公開範囲・プロフィール・安全" : "Visibility, profile, safety" },
    { group: basics, id: "storage", label: ja ? "アップロード容量" : "Upload capacity", hint: ja ? "容量とプラン" : "Capacity and plan" },
    { group: posting, id: "posts", label: ja ? "投稿管理" : "Posts", hint: ja ? "予約投稿と公開予定" : "Scheduled and upcoming posts" },
    { group: connections, id: "agent-access", label: ja ? "AIエージェント" : "AI agents", hint: ja ? "Codex・Claude・ローカルAIの権限" : "Codex, Claude, local AI access" },
    { group: connections, id: "federation", label: ja ? "外部SNS連携" : "Federation", hint: ja ? "Fediverseと公開範囲" : "Fediverse and sharing" },
    { group: connections, id: "external-protocols", label: ja ? "外部プロトコル" : "External protocols", hint: ja ? "外部アプリの読み取り範囲" : "External app read access" },
    { group: connections, id: "personal-node", label: "Personal Node", hint: ja ? "端末・同期・復旧" : "Devices, sync, recovery" },
    { group: connections, id: "distributed-network", label: ja ? "分散ネットワーク" : "Distributed network", hint: ja ? "ノードと保存先" : "Nodes and storage homes" },
    { group: dataGroup, id: "data-portability", label: ja ? "データの持ち出し" : "Data portability", hint: ja ? "書き出しと移行" : "Export and migration" },
    { group: dataGroup, id: "device-data", label: copy.deviceData, hint: ja ? "この端末の表示設定をリセット" : "Reset this device's preferences" },
  ];

  return (
    <SettingsDirectory
      title={ja ? "設定" : "Settings"}
      toggleLabel={ja ? "設定メニュー" : "Settings menu"}
      searchLabel={ja ? "設定を探す" : "Find a setting"}
      searchPlaceholder={ja ? "テーマ、通知、Codex…" : "Theme, notifications, Codex…"}
      closeLabel={ja ? "目次を閉じる" : "Close directory"}
      emptyText={ja ? "該当する設定がありません" : "No settings match"}
      sections={directorySections}
    >
    <div className="settings">
      <div className="settings-summary">
        <div>
          <span>{copy.deviceSettings}</span>
          <strong>{theme === "auto" ? `${copy.automatic} (${resolvedTheme === "dark" ? copy.dark : copy.light})` : theme === "dark" ? copy.dark : copy.light} · {textSize === "large" ? copy.largeText : copy.standardText}</strong>
        </div>
        <em className={saved ? "settings-saved settings-saved--visible" : "settings-saved"} role="status">{copy.saved}</em>
      </div>

      <section id="account" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{copy.accountTitle}</h2><p>{copy.accountHelp}</p></div></div>
        <div className="settings-card">
          <HubAccountControls />
          <div className="settings-note">
            <strong>ウォレット連携</strong>
            <p>ログインはパスキーのまま、署名した公開ウォレットをプロフィールへ任意で紐づけます。秘密鍵やシードフレーズはHubへ送信しません。</p>
          </div>
          <Link href="/token">ウォレットを確認・紐づける <span aria-hidden="true">→</span></Link>
          <Link href="/onboarding">{copy.recommendations} <span aria-hidden="true">›</span></Link>
          <HubPersonalizationSettings />
          <ContentSafetySettings />
        </div>
      </section>

      <section id="display" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{copy.displayTitle}</h2><p>{copy.displayHelp}</p></div></div>
        <div className="settings-card">
          <LanguageSelector locale={locale} label={copy.language} description={copy.languageHelp} />
          <RegionSelector region={region} label={copy.region} description={copy.regionHelp} />
          <label className="setting-select">
            <span><strong>{copy.theme}</strong><small>{copy.themeHelp}</small></span>
            <UiSelect value={theme} onChange={(event) => changeTheme(event.target.value as Theme)} aria-label={copy.theme}>
              <option value="auto">{copy.automatic}</option>
              <option value="dark">{copy.dark}</option>
              <option value="light">{copy.light}</option>
            </UiSelect>
          </label>
          <label className="setting-select">
            <span><strong>配色</strong><small>黒金は黒漆のボタンに金の文字、白黒は金を使いません</small></span>
            <UiSelect value={palette} onChange={(event) => changePalette(event.target.value as "default" | "gold-ivory")} aria-label="配色">
              <option value="gold-ivory">黒金</option>
              <option value="default">白黒</option>
            </UiSelect>
          </label>
          <label className="setting-select">
            <span>
              <strong>アクセントカラー</strong>
              <small>主要操作、リンク、選択位置に使う色です</small>
            </span>
            <UiSelect
              value={accent}
              onChange={(event) => changeAccent(event.target.value as Accent)}
              aria-label="アクセントカラー"
            >
              <option value="blue">ブルー</option>
              <option value="purple">パープル</option>
              <option value="pink">ピンク</option>
              <option value="orange">オレンジ</option>
              <option value="green">グリーン</option>
              <option value="graphite">グラファイト</option>
            </UiSelect>
          </label>
          <label className="setting-select">
            <span><strong>フィードの密度</strong><small>ホームの情報量と画像の見せ方を選びます</small></span>
            <UiSelect value={feedDensity} onChange={(event) => feedDensityChange(event.target.value as FeedDensity)} aria-label="フィードの密度">
              <option value="standard">標準</option>
              <option value="compact">コンパクト</option>
              <option value="media">メディア重視</option>
            </UiSelect>
          </label>
          <label className="setting-select">
            <span><strong>{copy.textSize}</strong><small>{copy.textSizeHelp}</small></span>
            <UiSelect value={textSize} onChange={(event) => changeTextSize(event.target.value as TextSize)} aria-label={copy.textSize}>
              <option value="standard">{copy.standard}</option>
              <option value="large">{copy.larger}</option>
            </UiSelect>
          </label>
          {/* 中身は components/translation-language-settings.tsx。v2 と同じものを使う（2026-09-05）。 */}
          <TranslationLanguageSettings locale={locale} onSaved={confirmSaved} />
          <Toggle label={copy.compact} description={copy.compactHelp} value={compact} onChange={compactChange} />
          <Toggle label={copy.reduceMotion} description={copy.reduceMotionHelp} value={reduceMotion} onChange={motionChange} />
          <Toggle label={copy.rightRail} description={copy.rightRailHelp} value={rightOpen} onChange={rightRailChange} />
        </div>
      </section>

      <section id="notifications" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{copy.notifications}</h2><p>{copy.notificationsHelp}</p></div></div>
        <div className="settings-card">
          <div className="settings-note"><strong>{copy.hubNotifications}</strong><p>{copy.hubNotificationsBody}</p></div>
          <NotificationSettings />
          <Link href="/notifications">{copy.checkNotifications} <span aria-hidden="true">›</span></Link>
        </div>
      </section>

      <section id="privacy" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{copy.privacy}</h2><p>{copy.privacyHelp}</p></div></div>
        <div className="settings-card">
          <div className="settings-note settings-note--privacy"><span className="settings-badge">{copy.visibility}</span><strong>{copy.publicProfile}</strong><p>{copy.publicProfileBody}</p></div>
          <ProfileSafetySettings />
          <Link href="/developers/services">開発者サービスを管理 <span aria-hidden="true">→</span></Link>
          <Link href={`/profile/${profileHandle}`}>{copy.checkProfile} <span aria-hidden="true">›</span></Link>
          <Link href="/about">{copy.dataPolicy} <span aria-hidden="true">›</span></Link>
        </div>
      </section>

      <section id="storage" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{ja ? "アップロード容量" : "Upload capacity"}</h2><p>{ja ? "アカウント全体で共有する容量と内訳を確認します" : "Review capacity shared across your account and its breakdown"}</p></div></div>
        <div className="settings-card">
          <AccountStoragePanel locale={locale} />
        </div>
      </section>

      <section id="posts" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>投稿管理</h2><p>予約投稿と公開予定を管理します</p></div></div>
        <div className="settings-card"><ScheduledPostManager /></div>
      </section>

      <section id="agent-access" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>AIエージェント</h2><p>Codex・ChatGPT・Claude・ローカルAIとの接続を管理します</p></div></div>
        <AgentAccessSettings />
      </section>

      <section id="federation" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{ja ? "外部SNS連携" : "External social connection"}</h2><p>{ja ? "公開範囲を選んでFediverseと接続します" : "Connect to the Fediverse with explicit public controls"}</p></div></div>
        <FederationSettings locale={locale === "ja" ? "ja" : "en"} />
        <DomainAliasSettings locale={locale === "ja" ? "ja" : "en"} />
      </section>

      <section id="external-protocols" className="settings-anchor-section">
        <div className="settings-section-title">
          <div>
            <h2>{ja ? "外部プロトコル" : "External protocols"}</h2>
            <p>{ja ? "外部アプリに許可する読み取り範囲と接続状態を管理します" : "Manage external app access and connection status"}</p>
          </div>
        </div>
        <ExternalProtocolSettings />
      </section>

      <section id="personal-node" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>Personal Node</h2><p>{ja ? "自分の端末を、データ・AI・権限の保管場所として接続します" : "Connect your device as the home for your data, AI, and permissions"}</p></div></div>
        <PersonalNodeSettings locale={locale === "ja" ? "ja" : "en"} />
        {/*
          * The node's own dashboard left the left column — it is a screen
          * people visit rarely and reach through their settings, not a
          * destination to keep in front of them. This is now its only door.
          */}
        <p className="settings-note">
          <a href="/node">{ja ? "Personal Nodeの詳細画面を開く →" : "Open the Personal Node dashboard →"}</a>
        </p>
      </section>

      <section id="distributed-network" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{ja ? "分散ネットワーク" : "Distributed network"}</h2><p>{ja ? "所有者ノードとHubの責任境界を管理します" : "Manage owner-operated nodes and Hub authority boundaries"}</p></div></div>
        <DistributedNetworkSettings locale={locale === "ja" ? "ja" : "en"} />
      </section>

      <section id="data-portability" className="settings-anchor-section">
        <div className="settings-section-title">
          <div>
            <h2>{ja ? "データの持ち出し" : "Data portability"}</h2>
            <p>{ja ? "各サービスが保有する自分のデータを標準形式で取得します" : "Download your data directly from each service in a standard format"}</p>
          </div>
        </div>
        <DataPortabilityCenter />
      </section>

      <section id="device-data" className="settings-anchor-section">
        <div className="settings-section-title"><div><h2>{copy.deviceData}</h2><p>{copy.deviceDataHelp}</p></div></div>
        <div className="settings-card">
          <div className="settings-note"><strong>{copy.resetItems}</strong><p>{copy.resetBody}</p></div>
          <UiButton type="button" className="settings-reset" onClick={resetPreferences}>{copy.reset}</UiButton>
        </div>
      </section>
    </div>
    </SettingsDirectory>
  );
}
