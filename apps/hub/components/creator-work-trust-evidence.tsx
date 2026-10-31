"use client";

import { useEffect, useState } from "react";

import type { VerifiedWorkTrustProjection } from "@/lib/server/work-trust-proof";

import styles from "./creator-center.module.css";

type StoredAgreement = { id?: unknown; accessToken?: unknown };
type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "verified"; projections: VerifiedWorkTrustProjection[] };

function storedAgreements(): Array<{ id: string; accessToken: string }> {
  const agreements = new Map<string, { id: string; accessToken: string }>();
  for (let index = 0; index < localStorage.length && agreements.size < 50; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith("hub.work-escrow.")) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null") as StoredAgreement | null;
      if (
        typeof value?.id === "string"
        && /^[0-9a-f-]{36}$/i.test(value.id)
        && typeof value.accessToken === "string"
        && /^[0-9a-f]{64}$/.test(value.accessToken)
      ) agreements.set(value.id, { id: value.id, accessToken: value.accessToken });
    } catch {
      // Ignore malformed device-only records.
    }
  }
  return [...agreements.values()];
}

async function verifiedProjection(
  agreement: { id: string; accessToken: string },
): Promise<VerifiedWorkTrustProjection | null> {
  const commerceResponse = await fetch(
    `/shopping/api/commerce/api/v1/work-agreements/${agreement.id}/trust-projection`,
    {
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${agreement.accessToken}`,
      },
    },
  );
  if (!commerceResponse.ok) return null;
  const commerce = await commerceResponse.json().catch(() => null) as { proof?: unknown } | null;
  if (typeof commerce?.proof !== "string") return null;
  const hubResponse = await fetch("/api/creator/work-proof", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ proof: commerce.proof }),
  });
  if (!hubResponse.ok) return null;
  const hub = await hubResponse.json().catch(() => null) as {
    projection?: VerifiedWorkTrustProjection;
  } | null;
  return hub?.projection ?? null;
}

export function CreatorWorkTrustEvidence() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    void (async () => {
      const agreements = storedAgreements();
      if (agreements.length === 0) {
        if (active) setState({ kind: "unavailable" });
        return;
      }
      const results = (await Promise.all(agreements.map(verifiedProjection)))
        .filter((value): value is VerifiedWorkTrustProjection => value !== null);
      const unique = [...new Map(results.map((value) => [value.evidenceKey, value])).values()];
      if (active) {
        setState(unique.length > 0
          ? { kind: "verified", projections: unique }
          : { kind: "unavailable" });
      }
    })().catch(() => {
      if (active) setState({ kind: "unavailable" });
    });
    return () => { active = false; };
  }, []);

  if (state.kind !== "verified") {
    return (
      <article>
        <span>納品完了・相互評価<small>commerce</small></span>
        <strong>{state.kind === "loading" ? "確認中" : "未確認"}</strong>
        <p>この端末に保存されたWork契約から、完了実績だけを確認します。</p>
        <em data-status={state.kind === "loading" ? "pending" : "not_available"}>
          {state.kind === "loading" ? "確認中" : "実績なし"}
        </em>
      </article>
    );
  }
  const mutual = state.projections.filter((item) => item.mutualReviewCompleted);
  const average = mutual.length
    ? mutual.reduce((sum, item) => sum + Number(item.ratingReceived), 0) / mutual.length
    : null;
  return (
    <article>
      <span>納品完了・相互評価<small>commerce</small></span>
      <strong>{state.projections.length.toLocaleString("ja-JP")}件</strong>
      <p>
        相互評価 {mutual.length.toLocaleString("ja-JP")}件
        {average === null ? "" : ` ・ 受けた評価 ${average.toFixed(1)} / 5`}
      </p>
      <small>契約ID・ウォレット・評価コメントはHubへ保存しません。</small>
      <em data-status="verified">確認済み</em>
    </article>
  );
}
