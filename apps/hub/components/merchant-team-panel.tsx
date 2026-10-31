"use client";

import { useEffect, useState } from "react";
import { merchantInviteUrl } from "@/lib/merchant-invite-link";

const API = "/shopping/api/commerce/api/v1/seller/wallet";
type Member = {
  id: string;
  role: string;
  status: string;
  passkeyCount: number;
  createdAt: string;
};
type Audit = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
};

export function MerchantTeamPanel() {
  const [members, setMembers] = useState<Member[]>([]),
    [events, setEvents] = useState<Audit[]>([]),
    [role, setRole] = useState("staff"),
    [inviteUrl, setInviteUrl] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [m, a] = await Promise.all([
      fetch(`${API}/members?limit=100`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${API}/audit?limit=20`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (m.ok) setMembers(((await m.json()) as { members: Member[] }).members);
    if (a.ok) setEvents(((await a.json()) as { events: Audit[] }).events);
  }
  useEffect(() => {
    void load();
  }, []);
  async function invite() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/invites`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        }),
        body = (await response.json().catch(() => null)) as {
          error?: string;
          invite?: { token: string };
        } | null;
      if (!response.ok || !body?.invite)
        throw new Error(body?.error ?? "招待を作成できませんでした。");
      const url = merchantInviteUrl(location.origin, body.invite.token);
      setInviteUrl(url);
      setMessage("24時間有効・一度限りの招待URLを作成しました。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "招待を作成できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!confirm("このメンバーと登録済みパスキーを失効しますか？")) return;
    setBusy(true);
    const response = await fetch(`${API}/members/${id}/revoke`, {
        method: "POST",
        credentials: "include",
      }),
      body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
    setMessage(
      response.ok
        ? "メンバーを失効しました。"
        : (body?.error ?? "失効できませんでした。"),
    );
    if (response.ok) await load();
    setBusy(false);
  }
  return (
    <section className="commerce-pos">
      <h2>店舗メンバー</h2>
      <p>
        人数の固定上限はありません。承認人数は端末数ではなくメンバー数で数えます。
      </p>
      <div className="commerce-pos-fields">
        <label>
          招待する役割
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="manager">店長</option>
            <option value="finance">経理</option>
            <option value="staff">スタッフ</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void invite()}>
          招待URLを作成
        </button>
      </div>
      {inviteUrl ? (
        <div>
          <label>
            招待URL
            <input readOnly value={inviteUrl} />
          </label>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(inviteUrl)}
          >
            コピー
          </button>
          <p>
            URLはこの画面でのみ表示されます。24時間後または使用後に無効になります。
          </p>
        </div>
      ) : null}
      <ul>
        {members.map((member) => (
          <li key={member.id}>
            <strong>{roleLabel(member.role)}</strong>・{member.status}・パスキー{" "}
            {member.passkeyCount}個{" "}
            {member.status === "active" &&
            !["owner", "recovery"].includes(member.role) ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void revoke(member.id)}
              >
                失効
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <h3>最近の監査記録</h3>
      <ul>
        {events.map((event) => (
          <li key={event.id}>
            {new Date(event.createdAt).toLocaleString("ja-JP")}・{event.action}
            ・{event.targetType}
          </li>
        ))}
      </ul>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
function roleLabel(role: string) {
  return (
    (
      {
        owner: "オーナー",
        manager: "店長",
        finance: "経理",
        staff: "スタッフ",
        recovery: "復旧担当",
      } as Record<string, string>
    )[role] ?? role
  );
}
