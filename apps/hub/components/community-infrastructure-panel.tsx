"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  COMMUNITY_INFORMATION_ARCHITECTURE,
  communityNodeModeLabel,
  type CommunityNodeMode,
} from "@/lib/community-space-policy";

type StoragePreference = {
  kind: "storage";
  mode: CommunityNodeMode;
  providerResourceId: string | null;
};
type StorageProvider = { id: string; title: string; origin: string };

const DEFAULT_PREFERENCE: StoragePreference = {
  kind: "storage",
  mode: "hub-standard",
  providerResourceId: null,
};

function providerHostname(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function CommunityInfrastructurePanel() {
  const [preference, setPreference] = useState(DEFAULT_PREFERENCE);
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/core/distributed-preferences", { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
      fetch("/api/distributed/resources?kind=storage&limit=50", { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
    ]).then(async ([preferenceResponse, providerResponse]) => {
      if (!preferenceResponse.ok || !providerResponse.ok) throw new Error();
      const preferenceBody = (await preferenceResponse.json()) as { preferences?: StoragePreference[] };
      const providerBody = (await providerResponse.json()) as { resources?: StorageProvider[] };
      setPreference(preferenceBody.preferences?.find((item) => item.kind === "storage") ?? DEFAULT_PREFERENCE);
      setProviders(providerBody.resources ?? []);
      setState("ready");
    }).catch((error) => {
      if ((error as { name?: string }).name !== "AbortError") {
        setMessage("保存先の設定を読み込めませんでした。");
        setState("error");
      }
    });
    return () => controller.abort();
  }, []);

  const selectValue = useMemo(() => preference.mode === "external"
    ? `external:${preference.providerResourceId ?? ""}`
    : preference.mode, [preference]);

  async function save(value: string) {
    const external = value.startsWith("external:");
    const mode: CommunityNodeMode = external ? "external" : value === "local" ? "local" : "hub-standard";
    const providerResourceId = external ? value.slice("external:".length) : null;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/core/distributed-preferences", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "storage", mode, providerResourceId }),
      });
      const body = (await response.json()) as { preference?: StoragePreference; error?: string };
      if (!response.ok || !body.preference) throw new Error(body.error);
      setPreference(body.preference);
      setMessage("既定の保存先を更新しました。コミュニティのURLや参加状態は変わりません。");
      setState("ready");
    } catch {
      setMessage("保存先を更新できませんでした。");
      setState("error");
    }
  }

  return <>
    <section>
      <header><div><h3>コミュニティとノード</h3><small>参加空間と保存基盤を分けて管理します</small></div></header>
      <div className="community-operations__summary-grid">
        {Object.values(COMMUNITY_INFORMATION_ARCHITECTURE).map((item) => <div key={item.label}>
          <strong>{item.label}</strong><span>{item.purpose}</span>
        </div>)}
      </div>
      <p>保存先を変更しても、コミュニティ、メンバー、ルール、チャンネル、公開URLは同じままです。</p>
    </section>
    <section>
      <header><div><h3>公開原本の既定保存先</h3><small>新しく公開する対応コンテンツに使う保存方針</small></div><strong>{communityNodeModeLabel(preference.mode)}</strong></header>
      <label>保存・配信ノード
        <select aria-label="公開原本の既定保存先" value={selectValue} disabled={state === "loading" || state === "saving"} onChange={(event) => void save(event.target.value)}>
          <option value="hub-standard">Hub管理</option>
          <option value="local">Personal Node</option>
          {providers.map((provider) => <option key={provider.id} value={`external:${provider.id}`}>{provider.title} · {providerHostname(provider.origin)}</option>)}
        </select>
      </label>
      <p>既存データは自動移動しません。対応する公開原本だけが選択したノードへ保存され、Hubには検索・表示用の情報が残ります。</p>
      <Link href="/settings?section=distributed">ノードと分散設定を開く</Link>
      {state === "loading" ? <p role="status">保存先を確認しています…</p> : null}
      {state === "saving" ? <p role="status">保存しています…</p> : null}
      {message ? <p role={state === "error" ? "alert" : "status"}>{message}</p> : null}
    </section>
  </>;
}
