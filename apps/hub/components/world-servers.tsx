"use client";

import { useEffect, useRef, useState } from "react";

/**
 * どの3Dワールドへ入るかを選ぶ。
 *
 * **入る前に、誰のサーバかを出す。** サーバの主は移動の審判なので、その世界に
 * 居る間の位置も発言も全部見えるし、なりすましもできる。**建てさせるという
 * 選択そのもので、隠せない。** だから選ぶ前に読ませる。
 *
 * この台の世界（大通り）は Hub 自身が動かしているので、同じ断りは要らない。
 */

type Operator = { id: string; displayName: string };
type Server = {
  name: string;
  title: string;
  about: string;
  address: string;
  status: "待ち" | "公開" | "停止";
  operator: Operator;
};

function isServer(value: unknown): value is Server {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Server>;
  const operator = item.operator;
  return typeof item.name === "string" && typeof item.title === "string" && typeof item.about === "string"
    && typeof item.address === "string" && (item.status === "待ち" || item.status === "公開" || item.status === "停止")
    && Boolean(operator) && typeof operator === "object"
    && typeof operator.id === "string" && typeof operator.displayName === "string";
}

/*
 * preferV2: v2 の中から使うときは行き先も v2 にする（2026-09-04）。
 * 既存の道を焼き込んでいたので、/v2/world に置くと押した瞬間に v2 の外へ出ていた。
 * サービス一覧と同じ直し方。
 */
export function WorldServers({ current, preferV2 = false }: { current: string | null; preferV2?: boolean }) {
  const base = preferV2 ? "/v2/world" : "/world";
  const [servers, setServers] = useState<Server[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loadSequence = useRef(0);
  const loadInFlight = useRef(false);
  const mounted = useRef(false);
  /** 通報し終えたもの。**押した後に押せたままだと、届いたか分からない。** */
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reportPending, setReportPending] = useState<Set<string>>(new Set());
  const reportPendingRef = useRef(new Set<string>());
  const [reportErrors, setReportErrors] = useState<Map<string, string>>(new Map());
  const reportSequence = useRef(new Map<string, number>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /**
   * 通報する。
   *
   * 通報は人が状況を確認するための合図で、件数による自動停止は行わない。
   * 画面では受付結果だけを示し、通報の集計や裁定は行わない。
   */
  const report = async (name: string) => {
    if (reportPendingRef.current.has(name) || reported.has(name)) return;
    const sequence = (reportSequence.current.get(name) ?? 0) + 1;
    reportSequence.current.set(name, sequence);
    const canApply = () => mounted.current && reportSequence.current.get(name) === sequence;
    reportPendingRef.current.add(name);
    setReportPending((held) => new Set(held).add(name));
    if (!confirm("このサーバを通報しますか。")) {
      reportPendingRef.current.delete(name);
      if (canApply()) setReportPending((held) => { const next = new Set(held); next.delete(name); return next; });
      return;
    }
    if (canApply()) setReportErrors((held) => { const next = new Map(held); next.delete(name); return next; });
    try {
      const response = await fetch(`/api/world/servers/${encodeURIComponent(name)}/report`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const result = response.ok ? await response.json().catch(() => null) as { reported?: unknown } | null : null;
      if (response.status === 200 && result?.reported === true) {
        if (canApply()) setReported((held) => new Set(held).add(name));
      } else if (response.ok) {
        if (canApply()) setReportErrors((held) => new Map(held).set(name, "通報の送信結果を確認できませんでした。"));
      } else {
        if (canApply()) setReportErrors((held) => new Map(held).set(name, "通報を送信できませんでした。"));
      }
    } catch {
      if (canApply()) setReportErrors((held) => new Map(held).set(name, "通報の送信結果を確認できませんでした。"));
    } finally {
      reportPendingRef.current.delete(name);
      if (canApply()) setReportPending((held) => { const next = new Set(held); next.delete(name); return next; });
    }
  };

  useEffect(() => {
    let gone = false;
    const sequence = ++loadSequence.current;
    loadInFlight.current = true;
    setServers(null);
    setFailed(false);
    void (async () => {
      try {
        const answer = await fetch("/api/world/servers", { credentials: "same-origin" });
        if (!answer.ok) throw new Error(String(answer.status));
        const body = await answer.json() as { servers?: unknown };
        if (!Array.isArray(body.servers) || !body.servers.every(isServer)) throw new Error("invalid servers response");
        if (!gone && sequence === loadSequence.current) setServers(body.servers);
      } catch {
        // **黙って空にしない。** 名簿が取れないことと、1つも無いことは別。
        if (!gone && sequence === loadSequence.current) setFailed(true);
      } finally {
        if (sequence === loadSequence.current) loadInFlight.current = false;
      }
    })();
    return () => { gone = true; };
  }, [reloadKey]);

  const retry = () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setReloadKey((key) => key + 1);
  };
  const build = <p className="hub-world-servers__note"><a href={`${base}/servers`}>自分のサーバを建てる</a></p>;

  if (failed) return <div className="hub-world-servers__note"><p>ほかの世界の一覧を取れませんでした</p><button type="button" onClick={retry}>再読み込み</button></div>;
  if (!servers) return <p className="hub-world-servers__note">読み込んでいます…</p>;
  if (servers.length === 0) return build;

  return (
    <section className="hub-world-servers" aria-label="ほかの世界">
      <h2>ほかの世界</h2>
      <p className="hub-world-servers__warning">
        ここから先は<strong>他の人が動かしているサーバ</strong>です。
        中に居る間の場所と発言は、そのサーバの主に見えます。
      </p>
      <ul>
        {servers.map((one) => (
          <li key={one.name} aria-current={one.name === current ? "true" : undefined}>
            <a href={`${base}?server=${encodeURIComponent(one.name)}`}>
              <b>{one.title}</b>
              <span className="hub-world-servers__who">主: {one.operator.displayName}</span>
              {one.about ? <span className="hub-world-servers__about">{one.about}</span> : null}
              {one.status !== "公開"
                ? <span className="hub-world-servers__status">{one.status}（自分にだけ見えています）</span>
                : null}
            </a>
            <button
              type="button"
              className="hub-world-servers__report"
              onClick={() => { void report(one.name); }}
              disabled={reported.has(one.name) || reportPending.has(one.name)}
            >
              {reported.has(one.name) ? "通報しました" : reportPending.has(one.name) ? "送信中…" : "通報する"}
            </button>
            {reportErrors.get(one.name) ? <span className="hub-world-servers__note" role="status">{reportErrors.get(one.name)}</span> : null}
          </li>
        ))}
      </ul>
      {build}
    </section>
  );
}
