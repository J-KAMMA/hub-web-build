"use client";

import { useEffect, useState } from "react";

import { V2AccessGateAttach } from "@/components/v2/v2-access-gate-attach";

/*
 * チャンネルの閲覧条件。旧 channel_token_gate は終了し、保有条件（アクセスゲート）に一本化した。
 * いま付いている門は GET /api/access-gates/attach で読む（管理者だけ）。
 */

type Channel = { id: string; name: string; archivedAt?: string };

function ChannelGate({ channel }: { channel: Channel }) {
  const [state, setState] = useState<{ loaded: boolean; gateId: string | null }>({ loaded: false, gateId: null });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/access-gates/attach?targetType=channel&targetId=${encodeURIComponent(channel.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const payload = (await response.json()) as { gateId?: unknown };
        setState({ loaded: true, gateId: typeof payload.gateId === "string" ? payload.gateId : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [channel.id]);

  return (
    <article>
      <div><strong>#{channel.name}</strong></div>
      {failed ? <small>閲覧条件を読み込めませんでした。</small> : state.loaded
        ? <V2AccessGateAttach targetType="channel" targetId={channel.id} initialGateId={state.gateId} />
        : <small>読み込み中…</small>}
    </article>
  );
}

export function CommunityChannelAccessGates({ channels }: { channels: Channel[] }) {
  const active = channels.filter((channel) => !channel.archivedAt);
  if (!active.length) return null;
  return (
    <section>
      <header><div><h3>チャンネルの閲覧条件</h3><small>トークンなどの保有条件を満たす人だけが読めるようにします</small></div></header>
      {active.map((channel) => <ChannelGate key={channel.id} channel={channel} />)}
    </section>
  );
}
