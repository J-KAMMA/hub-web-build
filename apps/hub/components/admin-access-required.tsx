import React from "react";
import { UiLinkButton, UiStatePanel } from "@/components/ui/primitives";

export function AdminAccessRequired() {
  return (
    <section className="admin-access-state">
      <UiStatePanel
        state="forbidden"
        title="管理者認証が必要です"
        titleAs="h1"
        description="この画面はHub運用担当者だけが利用できます。管理者セッションを確認してから、もう一度開いてください。"
        action={
          <UiLinkButton href="/admin/moderation" tone="primary">
            管理者ログインへ
          </UiLinkButton>
        }
      />
    </section>
  );
}
