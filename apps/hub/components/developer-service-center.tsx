"use client";

import { Send, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { UiButton, UiSelect } from "@/components/ui/primitives";

type ServiceRow = {
  id: string;
  serviceName: string;
  displayName: string;
  description: string;
  status: string;
  reviewNote?: string;
  capabilityName: string;
};

const initialForm = {
  serviceName: "",
  displayName: "",
  description: "",
  homepageUrl: "",
  privacyUrl: "",
  termsUrl: "",
  capabilityName: "",
  capabilityDescription: "",
  endpointUrl: "",
  inputSchemaUrl: "",
  outputSchemaUrl: "",
  permission: "read:public",
  costMode: "free",
  humanApproval: "not_required",
};

export function DeveloperServiceCenter() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [form, setForm] = useState(initialForm);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/platform/developer/services", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      setNotice("登録済みサービスを取得できませんでした。");
      return;
    }
    setServices((await response.json() as { services: ServiceRow[] }).services);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function field(name: keyof typeof initialForm) {
    return {
      value: form[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm((current) => ({ ...current, [name]: event.target.value })),
    };
  }

  async function create() {
    setBusy(true);
    const response = await fetch("/api/platform/developer/services", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceName: form.serviceName,
        displayName: form.displayName,
        description: form.description,
        homepageUrl: form.homepageUrl,
        privacyUrl: form.privacyUrl,
        termsUrl: form.termsUrl,
        capability: {
          name: form.capabilityName,
          description: form.capabilityDescription,
          endpointUrl: form.endpointUrl,
          httpMethod: "POST",
          inputSchemaUrl: form.inputSchemaUrl,
          outputSchemaUrl: form.outputSchemaUrl,
          permissions: [form.permission],
          costMode: form.costMode,
          humanApproval: form.humanApproval,
        },
      }),
    });
    setBusy(false);
    setNotice(response.ok ? "下書きを登録しました。内容を確認して審査へ提出してください。" : "manifestを登録できませんでした。名前空間、説明、公開HTTPS URLを確認してください。");
    if (response.ok) {
      setForm(initialForm);
      await load();
    }
  }

  async function transition(id: string, action: "submit" | "revoke") {
    setBusy(true);
    const response = await fetch(`/api/platform/developer/services/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    setNotice(response.ok ? action === "submit" ? "審査へ提出しました。" : "サービスを撤回しました。" : "現在の状態では操作できません。");
    await load();
  }

  return (
    <div className="settings">
      <section>
        <div className="settings-section-title">
          <div><h2>サービスを登録</h2><p>外部サービスのCapability manifestを下書き登録します</p></div>
        </div>
        <div className="settings-card">
          <label className="setting-select"><span><strong>サービス名</strong><small>external.organization.service</small></span><input {...field("serviceName")} /></label>
          <label className="setting-select"><span><strong>表示名</strong><small>利用者に表示する名前</small></span><input {...field("displayName")} /></label>
          <label className="setting-select"><span><strong>説明</strong><small>提供内容を20文字以上で説明</small></span><textarea {...field("description")} /></label>
          <label className="setting-select"><span><strong>ホームページ</strong><small>公開HTTPS URL</small></span><input type="url" {...field("homepageUrl")} /></label>
          <label className="setting-select"><span><strong>プライバシー</strong><small>公開HTTPS URL</small></span><input type="url" {...field("privacyUrl")} /></label>
          <label className="setting-select"><span><strong>利用規約</strong><small>公開HTTPS URL</small></span><input type="url" {...field("termsUrl")} /></label>
          <label className="setting-select"><span><strong>Capability名</strong><small>hub.external.organization.service.action</small></span><input {...field("capabilityName")} /></label>
          <label className="setting-select"><span><strong>Capability説明</strong><small>入力と結果を20文字以上で説明</small></span><textarea {...field("capabilityDescription")} /></label>
          <label className="setting-select"><span><strong>実行URL</strong><small>公開HTTPS POST endpoint</small></span><input type="url" {...field("endpointUrl")} /></label>
          <label className="setting-select"><span><strong>入力Schema</strong><small>JSON Schemaの公開HTTPS URL</small></span><input type="url" {...field("inputSchemaUrl")} /></label>
          <label className="setting-select"><span><strong>出力Schema</strong><small>JSON Schemaの公開HTTPS URL</small></span><input type="url" {...field("outputSchemaUrl")} /></label>
          <label className="setting-select"><span><strong>権限</strong><small>最小権限を1つ指定</small></span><input {...field("permission")} /></label>
          <label className="setting-select">
            <span><strong>料金方式</strong><small>実行前に利用者へ表示します</small></span>
            <UiSelect {...field("costMode")}><option value="free">無料</option><option value="fixed">固定</option><option value="metered">従量</option><option value="external">外部決済</option></UiSelect>
          </label>
          <label className="setting-select">
            <span><strong>人間の承認</strong><small>外部送信や変更を伴う場合は必須</small></span>
            <UiSelect {...field("humanApproval")}><option value="not_required">不要</option><option value="required">必要</option></UiSelect>
          </label>
          <UiButton type="button" disabled={busy} onClick={() => void create()}><ShieldCheck aria-hidden="true" />下書きを登録</UiButton>
        </div>
      </section>

      <section>
        <div className="settings-section-title"><div><h2>登録済みサービス</h2><p>審査状態とCapabilityを確認します</p></div></div>
        <div className="settings-card">
          {services.length ? services.map((service) => (
            <div className="setting-row" key={service.id}>
              <span>
                <strong>{service.displayName} · {service.status}</strong>
                <small>{service.serviceName} · {service.capabilityName}{service.reviewNote ? ` · ${service.reviewNote}` : ""}</small>
              </span>
              {service.status === "draft" || service.status === "changes_requested" ? (
                <UiButton type="button" disabled={busy} onClick={() => void transition(service.id, "submit")}><Send aria-hidden="true" />審査へ提出</UiButton>
              ) : null}
              {service.status !== "revoked" ? (
                <UiButton type="button" disabled={busy} onClick={() => void transition(service.id, "revoke")} aria-label="撤回"><Trash2 aria-hidden="true" /></UiButton>
              ) : null}
            </div>
          )) : <p className="settings-note">登録済みサービスはありません。</p>}
          {notice ? <p className="settings-note" role="status">{notice}</p> : null}
        </div>
      </section>
    </div>
  );
}
