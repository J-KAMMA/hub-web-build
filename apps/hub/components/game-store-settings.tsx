"use client";

import { type ChangeEvent, useEffect, useState } from "react";

import { GameBuildsPanel } from "@/components/game-builds-panel";
import { type ImageOptimizationPreset, optimizeImageFile } from "@/lib/client-image-optimizer";

/*
 * ゲームのストアの設定（2026-10-18）。ゲーム攻略の設定の「ストア」タブ。連携コミュニティの管理者か登録者だけが開ける。
 * 出品（なし／無料／有料）、有料なら Commerce のデジタル商品の ID（価格・決済・返金は Commerce が持つ）、
 * 発売日、対応機種、動作環境、スクリーンショット（最大8枚、ゲーム画像と同じ保存と上限）。
 */

const SCREENSHOT_PRESET: ImageOptimizationPreset = {
  width: 1280,
  height: 720,
  maxSourceBytes: 8 * 1024 * 1024,
  maxSourcePixels: 40_000_000,
  maxOutputBytes: 500 * 1024,
  mimeType: "image/webp",
  qualitySteps: [0.82, 0.72, 0.62, 0.52],
  sizeSteps: [1, 0.875, 0.75, 0.625],
};
const PLATFORMS = ["Windows", "macOS", "Linux", "PC", "PlayStation 5", "PlayStation 4", "Xbox Series X|S", "Xbox One", "Nintendo Switch", "iOS", "Android", "その他"];

type Settings = {
  storeListing: "free" | "paid" | null;
  commerceProductId: string | null;
  requirementsMinimum: string | null;
  requirementsRecommended: string | null;
  releaseDate: string | null;
  platforms: string[];
  /** 作者の申告（PLAN.md §2.7）。18 は18歳以上と申告した人だけが入れられる。 */
  ageRating?: "all" | "12" | "15" | "18";
};
type Shot = { id: string; url: string; position: number };

const ERRORS: Record<string, string> = {
  forbidden: "連携コミュニティの管理者だけが変更できます。",
  commerce_product_required: "有料にするには Commerce の商品IDを入れてください。",
  invalid_commerce_product_id: "商品IDの形を確認してください。",
  invalid_release_date: "発売日を確認してください。",
  invalid_age_rating: "年齢区分を確認してください。",
  invalid_platforms: "対応機種を1つ以上選んでください。",
  invalid_requirements_minimum: "動作環境（最低）は2000文字までです。",
  invalid_requirements_recommended: "動作環境（推奨）は2000文字までです。",
  screenshot_limit: "スクリーンショットは8枚までです。",
  attribution_required: "権利者または出典を入力してください。",
  game_not_published: "公開されたゲームだけを出品できます。",
  age_declaration_required: "18歳以上の申告が必要です。",
  invalid_image:"画像を確認できませんでした。",
};

export function GameStoreSettings({ gameId }: { gameId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState({ dataUrl: "", rightsBasis: "user_created", attribution: "" });
  const base = `/api/games/${encodeURIComponent(gameId)}`;

  useEffect(() => {
    let live = true;
    setState("loading");
    fetch(`${base}/store`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { settings?: Settings; screenshots?: Shot[]; error?: string } | null;
        if (!response.ok || !body?.settings) throw new Error(body?.error ?? "unavailable");
        if (!live) return;
        setSettings(body.settings);
        setShots(body.screenshots ?? []);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!live) return;
        setState("error");
        setMessage(ERRORS[error instanceof Error ? error.message : ""] ?? "ストアの設定を読み込めませんでした。");
      });
    return () => { live = false; };
  }, [base]);

  async function send(path: string, init: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "failed");
    return body;
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    try {
      const body = await send(`${base}/store`, { method: "PATCH", body: JSON.stringify({ ...settings, storeListing: settings.storeListing ?? "none" }) });
      setSettings(body.settings as Settings);
      setMessage("ストアの設定を保存しました。");
    } catch (error) {
      setMessage(ERRORS[error instanceof Error ? error.message : ""] ?? "保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function prepare(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setShot((current) => ({ ...current, dataUrl: "" }));
    try {
      const optimized = await optimizeImageFile(file, SCREENSHOT_PRESET);
      setShot((current) => ({ ...current, dataUrl: optimized.dataUrl }));
    } catch {
      setMessage("画像を準備できませんでした。");
    }
  }

  async function upload() {
    if (!shot.dataUrl) return;
    setBusy(true);
    setMessage("");
    try {
      const body = await send(`${base}/screenshots`, { method: "POST", body: JSON.stringify({ imageDataUrl: shot.dataUrl, rightsBasis: shot.rightsBasis, attribution: shot.attribution }) });
      setShots((current) => [...current, body.screenshot as Shot].sort((left, right) => left.position - right.position));
      setShot((current) => ({ ...current, dataUrl: "" }));
      setMessage("スクリーンショットを追加しました。");
    } catch (error) {
      setMessage(ERRORS[error instanceof Error ? error.message : ""] ?? "スクリーンショットを追加できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await send(`${base}/screenshots/${encodeURIComponent(id)}`, { method: "DELETE" });
      setShots((current) => current.filter((item) => item.id !== id));
    } catch {
      setMessage("スクリーンショットを外せませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p role="status">ストアの設定を読み込んでいます。</p>;
  if (state === "error" || !settings) return <p role="alert">{message || "ストアの設定を読み込めませんでした。"}</p>;
  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  return (
    <div className="community-game-manager__form game-store-settings">
      <label><span>出品</span>
        <select value={settings.storeListing ?? "none"} onChange={(event) => update({ storeListing: event.target.value === "none" ? null : event.target.value as "free" | "paid" })}>
          <option value="none">出品しない</option>
          <option value="free">無料（ライブラリに追加）</option>
          <option value="paid">有料（Commerce の商品）</option>
        </select>
      </label>
      {settings.storeListing === "paid" ? (
        <label><span>Commerce の商品ID（デジタル）</span>
          <input value={settings.commerceProductId ?? ""} onChange={(event) => update({ commerceProductId: event.target.value.trim() || null })} placeholder="00000000-0000-4000-8000-000000000000" />
          <small>価格・税込の表示・支払い・返金は Commerce が扱います。</small>
        </label>
      ) : null}
      <label><span>年齢区分</span>
        <select value={settings.ageRating ?? "all"} onChange={(event) => update({ ageRating: event.target.value as "all" | "12" | "15" | "18" })}>
          <option value="all">全年齢</option>
          <option value="12">12歳以上</option>
          <option value="15">15歳以上</option>
          <option value="18">18歳以上（暴力・恐怖の表現が強い。性的な表現は扱いません）</option>
        </select>
      </label>
      <label><span>発売日</span>
        <input type="date" value={settings.releaseDate ?? ""} onChange={(event) => update({ releaseDate: event.target.value || null })} />
      </label>
      <fieldset><legend>対応機種</legend>
        {PLATFORMS.map((name) => (
          <label key={name}>
            <input type="checkbox" checked={settings.platforms.includes(name)}
              onChange={(event) => update({ platforms: event.target.checked ? [...settings.platforms, name] : settings.platforms.filter((item) => item !== name) })} />
            {name}
          </label>
        ))}
      </fieldset>
      <label><span>動作環境（最低）</span>
        <textarea maxLength={2000} value={settings.requirementsMinimum ?? ""} onChange={(event) => update({ requirementsMinimum: event.target.value || null })} />
      </label>
      <label><span>動作環境（推奨）</span>
        <textarea maxLength={2000} value={settings.requirementsRecommended ?? ""} onChange={(event) => update({ requirementsRecommended: event.target.value || null })} />
      </label>
      <button type="button" onClick={save} disabled={busy}>ストアの設定を保存</button>

      <h3>スクリーンショット（{shots.length}/8）</h3>
      {shots.length ? (
        <ul className="game-store-settings__shots">
          {shots.map((item) => (
            <li key={item.id}><img src={item.url} alt="" /><button type="button" onClick={() => void remove(item.id)} disabled={busy}>外す</button></li>
          ))}
        </ul>
      ) : null}
      {shots.length < 8 ? (
        <>
          <label><span>画像</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={prepare} /></label>
          <label><span>利用根拠</span>
            <select value={shot.rightsBasis} onChange={(event) => setShot({ ...shot, rightsBasis: event.target.value })}>
              <option value="user_created">自作画像</option>
              <option value="official_permission">公式の利用許可</option>
              <option value="licensed">ライセンス取得済み</option>
            </select>
          </label>
          <label><span>権利者・出典</span><input value={shot.attribution} onChange={(event) => setShot({ ...shot, attribution: event.target.value })} /></label>
          <button type="button" onClick={upload} disabled={busy || !shot.dataUrl || (shot.rightsBasis !== "user_created" && !shot.attribution.trim())}>スクリーンショットを追加</button>
        </>
      ) : null}
      <GameBuildsPanel gameId={gameId} />
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
