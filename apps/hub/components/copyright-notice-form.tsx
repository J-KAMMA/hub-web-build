"use client";

import { FormEvent, useState } from "react";

// The browser sends the notice, including the claimant's contact details, directly to
// Rights Desk. Hub handlers never receive or proxy it.
const RIGHTS_API = process.env.NEXT_PUBLIC_RIGHTS_API_BASE || "/rights/api";

const ERRORS: Record<string, string> = {
  invalid_email: "メールアドレスの形式を確認してください。",
  invalid_display_name: "表示名は60文字以内で入力してください。",
  invalid_work_description: "権利対象の説明は20文字以上2000文字以内で入力してください。",
  invalid_claim_basis: "申告の根拠は20文字以上2000文字以内で入力してください。",
  invalid_target: "対象には、このハブのページのURLだけを入力してください。",
  invalid_targets: "対象のURLを1つ以上入力してください。",
  too_many_targets: "一度に申告できる対象は20件までです。",
  attestation_required: "3つの確認すべてに同意してください。",
  contact_in_text: "メールアドレスは連絡先の欄にだけ入力してください。",
  daily_limit: "1日に申告できる件数の上限に達しました。",
  rate_limited: "操作が多すぎます。しばらくしてからやり直してください。",
  too_large: "入力が大きすぎます。",
  challenge_failed: "確認に失敗しました。",
};

type Receipt = { caseNumber: string; statusToken: string };

export function CopyrightNoticeForm() {
  const [msg, setMsg] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setMsg("");
    try {
      const r = await fetch(`${RIGHTS_API}/v1/notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const p = (await r.json()) as Partial<Receipt> & { error?: string };
      if (r.ok && p.caseNumber && p.statusToken) {
        setReceipt({ caseNumber: p.caseNumber, statusToken: p.statusToken });
        form.reset();
        setMsg("申告を受け付けました。");
      } else {
        setMsg(ERRORS[p.error ?? ""] || "送信できませんでした。");
      }
    } catch {
      setMsg("送信できませんでした。");
    }
  }

  return (
    <form className="moderation-appeal" onSubmit={submit}>
      <h2>著作権に関する申告</h2>
      <p>
        対象と権利の根拠を具体的に記載してください。これは法的判断を自動化するものではありません。
        Hub のアカウントは要りません。連絡先は著作権の窓口（Rights Desk）だけが保管し、Hub や投稿者には渡しません。
        事件が終了してから3年後に消去します。
      </p>
      <label>
        申告者の種類
        <select name="kind" defaultValue="individual">
          <option value="individual">個人</option>
          <option value="organization">法人・団体</option>
        </select>
      </label>
      <label>
        氏名または団体名（連絡先。非公開）
        <input name="name" maxLength={100} required autoComplete="name" />
      </label>
      <label>
        メールアドレス（連絡先。非公開）
        <input name="email" type="email" maxLength={254} required autoComplete="email" />
      </label>
      <label>
        投稿者に表示する名前
        <input name="displayName" maxLength={60} required />
      </label>
      <label>
        対象のURL（1行に1件、20件まで）
        <textarea name="targets" rows={4} required placeholder="このハブのページのURL（1行に1つ）" />
      </label>
      <label>
        権利対象の説明
        <textarea name="workDescription" minLength={20} maxLength={2000} required />
      </label>
      <label>
        申告の根拠
        <textarea name="claimBasis" minLength={20} maxLength={2000} required />
      </label>
      <label>
        <input type="checkbox" name="attestGoodFaith" required /> 対象が権利を侵害していると、誠実に信じています。
      </label>
      <label>
        <input type="checkbox" name="attestAccurate" required /> この申告の内容は正確です。
      </label>
      <label>
        <input type="checkbox" name="attestAuthorized" required /> 私は権利者本人、または権利者から申告を任されています。
      </label>
      <button>送信する</button>
      {msg ? <p role="status">{msg}</p> : null}
      {receipt ? (
        <p role="status">
          受付番号：{receipt.caseNumber}　状況確認用の鍵：{receipt.statusToken}
          <br />
          この鍵は再表示できません。控えてください。
        </p>
      ) : null}
    </form>
  );
}
