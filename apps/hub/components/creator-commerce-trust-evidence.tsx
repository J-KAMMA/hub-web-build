"use client";

import React, { useEffect, useState } from "react";

import type { VerifiedCommerceCreatorProjection } from "@/lib/server/commerce-creator-proof";

import styles from "./creator-center.module.css";

type State =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "verified"; projection: VerifiedCommerceCreatorProjection };

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  const value = await response.json().catch(() => null);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function CreatorCommerceTrustEvidence() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const commerceResponse = await fetch(
          "/shopping/api/commerce/api/v1/seller/creator-projection",
          {
            credentials: "same-origin",
            headers: { accept: "application/json" },
          },
        );
        if (!commerceResponse.ok) {
          if (active) {
            setState({
              kind: "unavailable",
              message: commerceResponse.status === 401 || commerceResponse.status === 403
                ? "Commerceを連携すると確認できます。"
                : "現在、Commerceの証明を確認できません。",
            });
          }
          return;
        }
        const commercePayload = await responseJson(commerceResponse);
        const proof = typeof commercePayload?.proof === "string"
          ? commercePayload.proof
          : "";
        if (!proof) throw new Error("missing_proof");
        const verificationResponse = await fetch("/api/creator/commerce-proof", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ proof }),
        });
        const verifiedPayload = await responseJson(verificationResponse);
        if (!verificationResponse.ok || !verifiedPayload?.projection) {
          throw new Error("invalid_proof");
        }
        if (active) {
          setState({
            kind: "verified",
            projection: verifiedPayload.projection as VerifiedCommerceCreatorProjection,
          });
        }
      } catch {
        if (active) {
          setState({
            kind: "unavailable",
            message: "署名済みの取引完了証明を確認できません。",
          });
        }
      }
    })();
    return () => { active = false; };
  }, []);

  if (state.kind !== "verified") {
    return (
      <article>
        <span>完了した取引 <small>commerce</small></span>
        <strong>{state.kind === "loading" ? "確認中" : "未確認"}</strong>
        <p>
          {state.kind === "loading"
            ? "Commerceの短期証明を確認しています。"
            : state.message}
        </p>
        <em data-status={state.kind === "loading" ? "pending" : "not_available"}>
          {state.kind === "loading" ? "確認中" : "実績なし"}
        </em>
      </article>
    );
  }

  const { projection } = state;
  return (
    <article>
      <span>完了した取引 <small>commerce</small></span>
      <strong>{projection.orders.toLocaleString("ja-JP")}件</strong>
      <p>
        確定売上 {projection.settledSalesJpyc.toLocaleString("ja-JP")} JPYC
        {" ・ "}
        返金 {projection.refundedJpyc.toLocaleString("ja-JP")} JPYC
      </p>
      <small>
        確認 {new Date(projection.observedAt).toLocaleString("ja-JP")}
        {" ・ "}
        有効期限 {new Date(projection.expiresAt).toLocaleString("ja-JP")}
      </small>
      <em data-status="verified">確認済み</em>
    </article>
  );
}
