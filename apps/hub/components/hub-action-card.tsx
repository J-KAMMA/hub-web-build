import React from "react";

import type { HubActionProjection } from "@/lib/action-layer";

import styles from "./hub-action-card.module.css";

export function HubActionCard({ action }: { action: HubActionProjection }) {
  const content = (
    <>
      {action.imageUrl ? <img className={styles.image} src={action.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
      <span className={styles.body}>
        <span className={styles.eyebrow}>
          <span>{action.label}</span>
          {action.priceLabel ? <strong>{action.priceLabel}</strong> : null}
        </span>
        <strong className={styles.title}>{action.title}</strong>
        {action.description ? <span className={styles.description}>{action.description}</span> : null}
        <span className={styles.footer}>
          <small>{action.ownerService}</small>
          <span>{action.status === "available" ? "続ける →" : action.statusLabel ?? "現在利用できません"}</span>
        </span>
      </span>
    </>
  );

  if (action.status !== "available" || !action.href) {
    return <section className={`${styles.card} ${styles.unavailable}`} aria-disabled="true">{content}</section>;
  }

  const external = !action.href.startsWith("/");
  return (
    <a
      className={styles.card}
      href={action.href}
      data-action-type={action.type}
      data-owner-service={action.ownerService}
      data-projection-version={action.projectionVersion}
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow ugc" } : {})}
    >
      {content}
    </a>
  );
}
