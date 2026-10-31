"use client";

import { useState } from "react";

import { V2Icon } from "@/components/v2/v2-icons";

import {
  Avatar,
  Button,
  Chip,
  ChipRow,
  MediaBadge,
  MediaFrame,
  Segmented,
  Sheet,
  Skeleton,
  Switch,
  Tabs,
  ToastProvider,
  useToast,
} from "./index";

/*
 * Specimen of the shared v2 primitives for the development route
 * /v2/developers/ui. Capture it in light and dark when changing the tokens
 * or v2-foundation.css. Not linked from the product.
 */
function ToastButton() {
  const { show } = useToast();
  return (
    <Button
      variant="secondary"
      label="トーストを出す"
      onClick={() => show({ message: "保存しました", action: { label: "取り消す", onAction: () => undefined } })}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: "var(--v2-space-3)", padding: "var(--v2-space-4) 0", borderBottom: "1px solid var(--line)" }}>
      <h2 style={{ margin: 0, fontSize: "var(--type-title3-size)", lineHeight: "var(--type-title3-leading)", fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}

const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--v2-space-3)" } as const;

export function UiSpecimen() {
  const [tab, setTab] = useState("a");
  const [chip, setChip] = useState("all");
  const [on, setOn] = useState(true);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <div style={{ padding: "0 var(--v2-space-4) var(--v2-space-7)" }}>
        <Section title="ボタン">
          <div style={row}>
            <Button variant="primary" label="ポストする" />
            <Button variant="secondary" label="フォロー中" />
            <Button variant="plain" label="詳細" />
            <Button variant="icon" label="いいね" icon={<V2Icon name="heart" />} />
            <Button variant="icon" label="保存" icon={<V2Icon name="bookmark" />} pressed />
            <Button variant="primary" label="無効" disabled />
          </div>
        </Section>
        <Section title="チップ">
          <ChipRow label="種類">
            {["all", "people", "posts", "videos", "music", "articles"].map((id) => (
              <Chip key={id} selected={chip === id} onClick={() => setChip(id)}>{id}</Chip>
            ))}
          </ChipRow>
        </Section>
        <Section title="タブ">
          <Tabs
            label="タイムライン"
            value={tab}
            onChange={setTab}
            items={[{ id: "a", label: "おすすめ" }, { id: "b", label: "フォロー中" }, { id: "c", label: "人気", count: 12 }]}
          />
        </Section>
        <Section title="顔（24 / 32 / 40 / 48 / 96、人は丸・場は角丸）">
          <div style={row}>
            <Avatar name="Noa" size={24} />
            <Avatar name="Noa" size={32} />
            <Avatar name="Noa" size={40} />
            <Avatar name="Noa" size={48} />
            <Avatar name="Noa" size={96} />
            <Avatar name="【見本】写真散歩の会" size={48} shape="place" />
          </div>
        </Section>
        <Section title="媒体枠（16:9・1:1、再生時間の札）">
          <div style={{ ...row, alignItems: "flex-start" }}>
            <div style={{ width: 296 }}>
              <MediaFrame width={296} height={166} ratio="16/9"><MediaBadge>3:42</MediaBadge></MediaFrame>
            </div>
            <div style={{ width: 296 }}>
              <MediaFrame width={296} height={166} ratio="16/9"><MediaBadge tone="live">ライブ</MediaBadge></MediaFrame>
            </div>
            <div style={{ width: 148 }}>
              <MediaFrame width={148} height={148} ratio="1/1" radius="lg" />
            </div>
          </div>
        </Section>
        <Section title="スイッチと切替">
          <Switch label="自動再生" description="次の動画へ進みます" checked={on} onChange={setOn} />
          <Segmented
            label="テーマ"
            value={theme}
            onChange={setTheme}
            options={[{ value: "auto", label: "端末" }, { value: "light", label: "明るい" }, { value: "dark", label: "暗い" }]}
          />
        </Section>
        <Section title="トースト・シート">
          <div style={row}>
            <ToastButton />
            <Button variant="secondary" label="シートを開く" onClick={() => setOpen(true)} />
          </div>
          <Sheet open={open} onClose={() => setOpen(false)} title="共有">
            <p style={{ margin: 0, color: "var(--muted)" }}>リンクをコピーするか、他のアプリへ送れます。</p>
            <div style={{ ...row, marginTop: "var(--v2-space-4)" }}>
              <Button variant="primary" label="リンクをコピー" onClick={() => setOpen(false)} />
              <Button variant="plain" label="閉じる" onClick={() => setOpen(false)} />
            </div>
          </Sheet>
        </Section>
        <Section title="骨組み（投稿・動画・音楽・行）">
          <Skeleton kind="post" count={2} />
          <div style={{ maxWidth: 296 }}>
            <Skeleton kind="video" count={1} />
          </div>
          <Skeleton kind="music" count={2} />
          <Skeleton kind="row" count={2} />
        </Section>
      </div>
    </ToastProvider>
  );
}
