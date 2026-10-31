"use client";

import React from "react";

import type { CreatorActivityPeriod } from "@/lib/creator-activity-period";
import type { CreatorActivitySummary } from "@/lib/server/d1-creator-center";

import styles from "./creator-center.module.css";

const periodLabel: Record<CreatorActivityPeriod, string> = {
  "30d": "過去30日",
  "90d": "過去90日",
  all: "全期間",
};

function csvCell(value: string | number): string {
  const normalized = String(value).replace(/"/g, "\"\"");
  return `"${normalized}"`;
}

export function CreatorActivityExport({
  period,
  summary,
}: {
  period: CreatorActivityPeriod;
  summary: CreatorActivitySummary;
}) {
  const exportCsv = () => {
    const rows: Array<[string, string | number]> = [
      ["期間", periodLabel[period]],
      ["投稿", summary.posts],
      ["表示", summary.impressions],
      ["リンク遷移", summary.linkTransitions],
      ["返信", summary.replies],
      ["リポスト", summary.reposts],
      ["いいね", summary.likes],
      ["保存", summary.bookmarks],
      ["依頼・サービス", summary.workListings],
      ["求人", summary.jobListings],
      ["運営コミュニティ", summary.communities],
    ];
    const csv = [
      ["項目", "値"].map(csvCell).join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hub-creator-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button className={styles.exportButton} type="button" onClick={exportCsv}>
      CSVを書き出す
    </button>
  );
}
