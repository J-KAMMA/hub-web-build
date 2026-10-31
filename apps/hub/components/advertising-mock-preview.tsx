"use client";

import React, { useState } from "react";

type MockFormat = "banner" | "rectangle" | "native" | "mobile";
type MockTheme = "light" | "dark";

const MOCK_CREATIVES = [
  {
    id: "civic-lab",
    brand: "Civic Lab",
    mark: "CL",
    eyebrow: "公共を学ぶオンライン講座",
    title: "制度を、わかる言葉で考える。",
    copy: "政策・地域・デジタル社会を扱う架空の学習プログラムです。",
    cta: "講座を見る",
    color: "var(--emphasis)",
  },
  {
    id: "paper-trail",
    brand: "Paper Trail Books",
    mark: "PT",
    eyebrow: "今月の選書",
    title: "考えるための本棚をつくろう。",
    copy: "社会、技術、文化を横断する架空の独立系書店です。",
    cta: "選書を見る",
    color: "var(--emphasis)",
  },
  {
    id: "quiet-cloud",
    brand: "Quiet Cloud",
    mark: "QC",
    eyebrow: "小さなチームのクラウド",
    title: "運用を静かに、仕事を軽く。",
    copy: "プライバシーを重視する架空の国内ホスティングサービスです。",
    cta: "サービスを見る",
    color: "var(--emphasis)",
  },
] as const;

export function AdvertisingMockPreview() {
  const [creativeId, setCreativeId] = useState<(typeof MOCK_CREATIVES)[number]["id"]>("civic-lab");
  const [format, setFormat] = useState<MockFormat>("banner");
  const [theme, setTheme] = useState<MockTheme>("light");
  const creative = MOCK_CREATIVES.find((item) => item.id === creativeId) ?? MOCK_CREATIVES[0];

  return <div className="ad-mock-workspace">
    <section className="ad-mock-controls" aria-label="広告モック設定">
      <label><span>クリエイティブ</span><select value={creativeId} onChange={(event) => setCreativeId(event.target.value as typeof creativeId)}>{MOCK_CREATIVES.map((item) => <option key={item.id} value={item.id}>{item.brand}</option>)}</select></label>
      <label><span>広告形式</span><select value={format} onChange={(event) => setFormat(event.target.value as MockFormat)}><option value="banner">横長バナー</option><option value="rectangle">レクタングル</option><option value="native">ネイティブスポンサー</option><option value="mobile">モバイル</option></select></label>
      <label><span>背景</span><select value={theme} onChange={(event) => setTheme(event.target.value as MockTheme)}><option value="light">ライト</option><option value="dark">ダーク</option></select></label>
    </section>

    <section className="ad-mock-stage" data-theme={theme} aria-label="広告モックプレビュー">
      <div className={`ad-mock-creative ad-mock-creative--${format}`} data-mock-ad="true" data-creative={creative.id}>
        <span className="ad-mock-creative__disclosure">広告・モック</span>
        <div className="ad-mock-creative__mark" style={{ background: creative.color }}>{creative.mark}</div>
        <div className="ad-mock-creative__copy">
          <small>{creative.eyebrow}</small>
          <strong>{creative.title}</strong>
          <p>{creative.copy}</p>
          <span className="ad-mock-creative__brand">{creative.brand}</span>
        </div>
        <span className="ad-mock-creative__cta" aria-hidden="true">{creative.cta}</span>
      </div>
      <p className="ad-mock-stage__notice">プレビュー専用・クリック不可・外部通信なし</p>
    </section>

    <section className="ad-mock-notes">
      <h2>確認項目</h2>
      <ul><li>「広告」表示が本文やナビゲーションと区別できる</li><li>モバイル幅でも見出しと提供元が読める</li><li>CTAが実際のボタンやリンクとして動作しない</li><li>実在企業・実広告タグ・計測スクリプトを使用しない</li></ul>
    </section>
  </div>;
}
