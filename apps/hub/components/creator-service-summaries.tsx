"use client";

import React, { useEffect, useState } from "react";

import {
  notConnectedCreatorProjection,
  parseAdvertisingCreatorProjection,
  parseCommerceCreatorProjection,
  parseMusicCreatorProjection,
  unavailableCreatorProjection,
  type CreatorServiceId,
  type CreatorServiceProjection,
} from "@/lib/creator-service-projection";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import styles from "./creator-center.module.css";

const serviceMeta: Record<CreatorServiceId, { title: string; description: string }> = {
  commerce: { title: "ストア", description: "販売と確定売上" },
  music: { title: "音楽", description: "公開と安全確認の状態" },
  advertising: { title: "広告", description: "キャンペーンと利用額" },
};

const initialProjections: Record<CreatorServiceId, CreatorServiceProjection> = {
  commerce: notConnectedCreatorProjection("commerce"),
  music: unavailableCreatorProjection("music"),
  advertising: unavailableCreatorProjection("advertising"),
};

async function json(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

async function loadMusic(): Promise<CreatorServiceProjection> {
  const assertionResponse = await fetch("/account/api/v1/assertions/music", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (assertionResponse.status === 401 || assertionResponse.status === 403) {
    return notConnectedCreatorProjection("music");
  }
  const assertionPayload = await json(assertionResponse);
  const assertion = assertionPayload !== null
    && typeof assertionPayload === "object"
    && typeof (assertionPayload as { assertion?: unknown }).assertion === "string"
    ? (assertionPayload as { assertion: string }).assertion
    : "";
  if (!assertionResponse.ok || !assertion) return unavailableCreatorProjection("music");

  const response = await fetch("/music/api/creator/summary", {
    credentials: "same-origin",
    headers: { accept: "application/json", authorization: `Bearer ${assertion}` },
  });
  if (response.status === 401 || response.status === 403) return notConnectedCreatorProjection("music");
  return response.ok
    ? parseMusicCreatorProjection(await json(response))
    : unavailableCreatorProjection("music");
}

async function loadCommerce(): Promise<CreatorServiceProjection> {
  const response = await fetch(
    "/shopping/api/commerce/api/v1/seller/creator-projection",
    {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 401 || response.status === 403) {
    return notConnectedCreatorProjection("commerce");
  }
  if (!response.ok) return unavailableCreatorProjection("commerce");
  const payload = await json(response);
  const proof = payload !== null
    && typeof payload === "object"
    && typeof (payload as { proof?: unknown }).proof === "string"
    ? (payload as { proof: string }).proof
    : "";
  if (!proof) return unavailableCreatorProjection("commerce");
  const verification = await fetch("/api/creator/commerce-proof", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ proof }),
  });
  return verification.ok
    ? parseCommerceCreatorProjection(await json(verification))
    : unavailableCreatorProjection("commerce");
}

async function loadAdvertising(): Promise<CreatorServiceProjection> {
  const response = await fetch("/api/ads/advertiser/dashboard", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    return notConnectedCreatorProjection("advertising");
  }
  return response.ok
    ? parseAdvertisingCreatorProjection(await json(response))
    : unavailableCreatorProjection("advertising");
}

function ProjectionCard({ projection }: { projection: CreatorServiceProjection }) {
  /* 見ている面の中に留まる。v2 に無い画面は hubSurfacePath が既存の道のまま返す。 */
  const surface = useHubUiSurface();
  const meta = serviceMeta[projection.service];
  const stateLabel = projection.status === "not_connected"
    ? "連携すると集計を表示できます"
    : projection.status === "unavailable"
      ? "現在、集計を確認できません"
      : projection.status === "empty"
        ? "まだ実績がありません"
        : "";
  return (
    <a className={styles.serviceSummaryCard} href={hubSurfacePath(surface, projection.href)}>
      <span className={styles.serviceSummaryHeading}>
        <span><strong>{meta.title}</strong><small>{meta.description}</small></span>
        <span aria-hidden="true">→</span>
      </span>
      {projection.metrics.length > 0 ? (
        <dl className={styles.serviceSummaryMetrics}>
          {projection.metrics.map((metric) => (
            <div key={metric.id}>
              <dt>{metric.label}</dt>
              <dd>{metric.value.toLocaleString("ja-JP")}{metric.unit}</dd>
            </div>
          ))}
        </dl>
      ) : <small className={styles.serviceSummaryState}>{stateLabel}</small>}
    </a>
  );
}

export function CreatorServiceSummaries() {
  const [projections, setProjections] = useState(initialProjections);

  useEffect(() => {
    let active = true;
    const commit = (service: CreatorServiceId, value: CreatorServiceProjection) => {
      if (active) setProjections((current) => ({ ...current, [service]: value }));
    };
    void loadCommerce()
      .then((value) => commit("commerce", value))
      .catch(() => commit("commerce", unavailableCreatorProjection("commerce")));
    void loadMusic()
      .then((value) => commit("music", value))
      .catch(() => commit("music", unavailableCreatorProjection("music")));
    void loadAdvertising()
      .then((value) => commit("advertising", value))
      .catch(() => commit("advertising", unavailableCreatorProjection("advertising")));
    return () => { active = false; };
  }, []);

  return (
    <section className={styles.section} aria-live="polite">
      <header>
        <h2>サービス集計</h2>
        <p>各サービスで確認できた集計だけを表示します。</p>
      </header>
      <div className={styles.serviceSummaries}>
        {(["commerce", "music", "advertising"] as const).map((service) => (
          <ProjectionCard key={service} projection={projections[service]} />
        ))}
      </div>
    </section>
  );
}
