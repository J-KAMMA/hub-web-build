"use client";

import { useEffect, useRef, useState } from "react";
import { cleanLabel, isServerName, readAddress } from "@jkamma/hub-world/registry";

/**
 * 自分のサーバを届け出る。
 *
 * **引き受けるものを、押す場所で出す。** 建てた人には、その世界に居る人の
 * 位置も発言も全部見える。手順書にも書いてあるが、読まずにここへ来る人が居る。
 * 届け出る釦の隣が、最後に伝えられる場所になる。
 */

type Server = {
  name: string;
  title: string;
  about: string;
  address: string;
  status: "待ち" | "公開" | "停止";
  operator: { id: string; displayName: string };
};

const EMPTY = { name: "", title: "", about: "", address: "" };

function isServer(value: unknown): value is Server {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Server>;
  return typeof row.name === "string" && typeof row.title === "string"
    && typeof row.about === "string" && typeof row.address === "string"
    && (row.status === "待ち" || row.status === "公開" || row.status === "停止")
    && !!row.operator && typeof row.operator.id === "string" && typeof row.operator.displayName === "string";
}

export function WorldServerForm({ me }: { me: string }) {
  const [mine, setMine] = useState<Server[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saying, setSaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const owner = useRef(me);
  owner.current = me;
  const loadId = useRef(0);
  const loadBusy = useRef(false);
  const sendBusy = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;

  const load = async (force = false) => {
    if (!mounted.current || owner.current !== me || (loadBusy.current && !force)) return;
    const epoch = lifetime.current;
    const id = ++loadId.current;
    const current = () => mounted.current && owner.current === me && lifetime.current === epoch && loadId.current === id;
    loadBusy.current = true;
    setLoadState("loading");
    try {
      const answer = await fetch("/api/world/servers", { credentials: "same-origin" });
      if (!answer.ok) throw new Error(String(answer.status));
      const body = await answer.json() as { servers?: unknown } | null;
      if (!Array.isArray(body?.servers) || !body.servers.every(isServer)) throw new Error("Invalid server list");
      if (current()) {
        setMine(body.servers.filter((one) => one.operator.id === me));
        setLoadState("ready");
      }
    } catch {
      if (current()) setLoadState("error");
    } finally {
      if (current()) loadBusy.current = false;
    }
  };

  useEffect(() => {
    mounted.current = true;
    lifetime.current += 1;
    loadBusy.current = false;
    sendBusy.current = false;
    setBusy(false);
    setMine(null);
    setSaying(null);
    setForm(EMPTY);
    void load();
    return () => { mounted.current = false; lifetime.current += 1; loadId.current += 1; };
  }, [me]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sendBusy.current || !mounted.current || owner.current !== me) return;
    const submitted = { ...form };
    if (!isServerName(submitted.name) || !cleanLabel(submitted.title, 40) || !readAddress(submitted.address)) {
      setSaying("名前・表示名・繋ぎ先を確認してください。");
      return;
    }
    const epoch = lifetime.current;
    const current = () => mounted.current && owner.current === me && lifetime.current === epoch;
    sendBusy.current = true;
    setBusy(true);
    setSaying(null);
    try {
      const answer = await fetch("/api/world/servers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted)
      });
      const body = await answer.json().catch(() => null) as { error?: unknown; name?: unknown; status?: unknown } | null;
      if (!current()) return;
      if (!answer.ok) {
        setSaying(typeof body?.error === "string" && body.error.trim() ? body.error.slice(0, 300) : "届け出られませんでした");
      } else if (answer.status === 201 && body?.name === submitted.name && (body.status === "待ち" || body.status === "公開" || body.status === "停止")) {
        setSaying(`${submitted.name} を届け出ました`);
        if (Object.keys(EMPTY).every((key) => formRef.current[key as keyof typeof EMPTY] === submitted[key as keyof typeof EMPTY])) setForm(EMPTY);
        await load(true);
      } else {
        setSaying("届け出の送信結果を確認できませんでした。");
      }
    } catch {
      if (current()) setSaying("届け出の送信結果を確認できませんでした。");
    } finally {
      if (current()) { sendBusy.current = false; setBusy(false); }
    }
  };

  const put = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((held) => ({ ...held, [key]: event.target.value }));

  return (
    <section className="hub-world-form">
      <p className="hub-world-servers__warning" role="note">
        建てると、<strong>その世界に居る人の位置と発言があなたに見えます</strong>。
        なりすまして発言することもできます。
        入る人は<strong>あなたを信じて入る</strong>ことになります。
      </p>

      <form onSubmit={send}>
        <label>
          名前（英小文字・数字・-）
          <input value={form.name} onChange={put("name")} maxLength={31} required
            pattern="[a-z0-9][a-z0-9-]*" placeholder="kamome" />
        </label>
        <label>
          表示名
          <input value={form.title} onChange={put("title")} maxLength={40} required
            placeholder="かもめ亭" />
        </label>
        <label>
          説明
          <input value={form.about} onChange={put("about")} maxLength={200}
            placeholder="静かな部屋です" />
        </label>
        <label>
          繋ぎ先（wss のみ）
          <input value={form.address} onChange={put("address")} maxLength={200} required
            placeholder="wss://kamome.example.com" />
        </label>
        <button type="submit" disabled={busy}>{busy ? "送っています…" : "届け出る"}</button>
      </form>

      {saying ? <p className="hub-world-form__saying" role="status">{saying}</p> : null}

      <h2>届け出たもの</h2>
      {loadState === "loading" ? <p className="hub-world-servers__note" role="status">読み込んでいます…</p> : null}
      {loadState === "error" ? <div className="hub-world-servers__note" role="alert"><p>いま届け出たものを読めませんでした</p><button type="button" onClick={() => { void load(); }}>再読み込み</button></div> : null}
      {loadState === "ready" && mine?.length === 0 ? <p className="hub-world-servers__note">まだありません</p> : null}
      {mine && mine.length > 0 ? (
        <ul className="hub-world-form__mine">
          {mine.map((one) => (
            <li key={one.name}>
              <b>{one.title}</b>
              <code>{one.address}</code>
              <span>{one.status}</span>
              {one.status === "停止"
                ? <span className="hub-world-form__stopped">
                    一覧から下ろされています。あなたのサーバ自体は動いています。
                  </span>
                : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
