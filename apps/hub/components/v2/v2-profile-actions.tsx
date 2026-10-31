"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { UserListMembershipButton } from "@/components/user-list-membership-button";
import { V2Button } from "@/components/v2/v2-button";
import dynamic from "next/dynamic";

/* viem is heavy; keep it out of the profile route initial bundle. */
const WalletTipControl = dynamic(() => import("@/components/wallet-tip-control").then((m) => m.WalletTipControl), { ssr: false });

/*
 * 他人のプロフィールでの操作。既存の follow-toggle-button / profile-public-details
 * （ProfileSafetyMenu）/ message-start-button から機能だけを抜いた。
 *
 * 落とさなかったもの: フォロー（押した瞬間に反映、失敗したら戻す）、
 * メッセージを始める、ミュート／ブロック、通報（理由と詳細）。
 * 投げ銭とリストへの追加は 2026-09-04 に足した（旦那様の「古いUIを出さない」）。
 * どちらも既存の部品をそのまま置く。ウォレットの署名と一覧の管理を持っている。
 */
export function V2ProfileActions({
  targetProfileId,
  handle,
  initialFollowing,
  initialControl,
  signedIn,
  locale,
  canMessage = true,
  remoteHost = null,
}: {
  targetProfileId: string;
  /* 投げ銭は相手の @ で送る。 */
  handle: string;
  initialFollowing: boolean;
  initialControl: { muted: boolean; blocked: boolean };
  signedIn: boolean;
  locale: string;
  /** 他のハブの人にはDMを送れない（ハブ間DMは当面しない）。 */
  canMessage?: boolean;
  remoteHost?: string | null;
}) {
  const ja = locale === "ja";
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [control, setControl] = useState(initialControl);
  const [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const call = async (url: string, method: string, body: unknown) => {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(payload.error || String(response.status));
    return payload;
  };

  const toggleFollow = () => {
    if (!signedIn || pending) return;
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      try {
        const payload = await call("/api/follows/toggle", "POST", { target_profile_id: targetProfileId, active: next });
        if (typeof payload.following === "boolean") setFollowing(payload.following);
        setMessage(null);
        router.refresh();
      } catch (caught) {
        setFollowing(!next);
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "反映できませんでした。" : "That did not go through."));
      }
    });
  };

  const setSafety = (action: "mute" | "block", enabled: boolean) => {
    if (!signedIn || pending) return;
    if (enabled && !window.confirm(action === "block" ? (ja ? "ブロックしますか。相互にやり取りできなくなります。" : "Block this person?") : (ja ? "ミュートしますか。" : "Mute this person?"))) return;
    const before = control;
    setControl((current) => ({ ...current, [action === "mute" ? "muted" : "blocked"]: enabled }));
    startTransition(async () => {
      try {
        await call("/api/profile/safety", "PATCH", { targetProfileId, action, enabled });
        setMessage(null);
      } catch (caught) {
        setControl(before);
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "反映できませんでした。" : "That did not go through."));
      }
    });
  };

  const report = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await call("/api/profile/safety", "POST", { targetProfileId, reason: form.get("reason"), details: form.get("details") });
        setReporting(false);
        setMessage(ja ? "通報を受け付けました。" : "Report received.");
      } catch (caught) {
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "通報を送れませんでした。" : "Could not report."));
      }
    });
  };

  const startMessage = () => {
    if (!signedIn || pending) return;
    startTransition(async () => {
      try {
        const payload = await call("/api/messages/start", "POST", { target_profile_id: targetProfileId });
        if (typeof payload.conversation_id === "string") router.push(`/v2/messages?conversation=${encodeURIComponent(payload.conversation_id)}`);
      } catch (caught) {
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "会話を開始できませんでした。" : "Could not start a conversation."));
      }
    });
  };

  if (!signedIn) return null;

  return (
    <div className="v2-profile__actions">
      <div className="v2-post__actions">
        <V2Button variant={following ? "text" : "primary"} label={following ? (ja ? "フォロー中" : "Following") : (ja ? "フォロー" : "Follow")} pressed={following} disabled={pending || control.blocked} onClick={toggleFollow} />
        {canMessage ? <V2Button icon="message" label={ja ? "メッセージ" : "Message"} disabled={pending || control.blocked} onClick={startMessage} /> : null}
        <V2Button icon="mute" label={control.muted ? (ja ? "ミュート解除" : "Unmute") : (ja ? "ミュート" : "Mute")} pressed={control.muted} disabled={pending} onClick={() => setSafety("mute", !control.muted)} />
        <V2Button icon="block" label={control.blocked ? (ja ? "ブロック解除" : "Unblock") : (ja ? "ブロック" : "Block")} pressed={control.blocked} disabled={pending} onClick={() => setSafety("block", !control.blocked)} />
        <V2Button icon="flag" label={ja ? "通報" : "Report"} expanded={reporting} onClick={() => setReporting((current) => !current)} />
      </div>
      <div className="v2-profile__actions-extra">
        <WalletTipControl handle={handle} isCurrentUser={false} />
        {signedIn ? <UserListMembershipButton kind="profile" targetId={targetProfileId} /> : null}
      </div>
      {!canMessage ? <p className="v2-note">{ja ? `別のハブ${remoteHost ? `（${remoteHost}）` : ""}の人です。返信やメンションで話しかけられます。ダイレクトメッセージは送れません。` : "This person is on another Hub. You can reply or mention them; direct messages are not available."}</p> : null}
      {message ? <p className="v2-note" role="status">{message}</p> : null}
      {reporting ? (
        <form className="v2-profile__report" onSubmit={report}>
          <label className="v2-filter__row">
            <span>{ja ? "理由" : "Reason"}</span>
            <select name="reason" defaultValue="spam">
              <option value="spam">{ja ? "スパム" : "Spam"}</option>
              <option value="harassment">{ja ? "嫌がらせ" : "Harassment"}</option>
              <option value="impersonation">{ja ? "なりすまし" : "Impersonation"}</option>
              <option value="other">{ja ? "その他" : "Other"}</option>
            </select>
          </label>
          <textarea className="v2-reply__input" name="details" rows={3} maxLength={500} placeholder={ja ? "詳しく（任意）" : "Details (optional)"} />
          <div className="v2-reply__footer">
            <button type="button" className="v2-action" onClick={() => setReporting(false)}>{ja ? "やめる" : "Cancel"}</button>
            <button type="submit" className="v2-reply__submit" disabled={pending}>{ja ? "送る" : "Send"}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
