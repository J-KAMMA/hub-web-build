"use client";

import { useState } from "react";

import {
  planLegacyHubSearchImport,
  type LegacyHubSearchCandidate,
  type SavedHubSearch,
} from "@/lib/v2-saved-searches";

type LegacyImportStatus = "imported" | "duplicate" | "full" | "invalid" | "storage_error";

type LegacySearchDraft = {
  label: string;
  query: string;
};

type V2LegacySearchImportProps = {
  candidates: readonly LegacyHubSearchCandidate[];
  savedSearches: readonly SavedHubSearch[];
  japanese: boolean;
  onImport: (candidate: { query: string; label: string }) => LegacyImportStatus;
};

function statusMessage(status: LegacyImportStatus, japanese: boolean, queryTooLong: boolean): string {
  if (status === "imported") return japanese ? "保存一覧に追加しました。" : "Added to saved searches.";
  if (status === "duplicate") return japanese ? "保存済み" : "Already saved";
  if (status === "full") {
    return japanese
      ? "保存は10件までです。現在の一覧を整理してください"
      : "Saved searches are limited to 10. Please organize the current list.";
  }
  if (status === "storage_error") {
    return japanese
      ? "保存一覧を更新できませんでした。もう一度お試しください。"
      : "Could not update saved searches. Please try again.";
  }
  if (queryTooLong) {
    return japanese
      ? "元の検索語が100文字を超えています。100文字以内に編集してから追加してください。"
      : "The original search term is longer than 100 characters. Edit it to 100 characters or fewer before adding.";
  }
  return japanese
    ? "検索語を入力してから追加してください。"
    : "Enter a search term before adding.";
}

/**
 * Offers a deliberate, row-by-row import from the old saved-search surface.
 * The component receives candidates and the current canonical list from its
 * parent; it never reads, writes, or migrates browser storage itself.
 */
export function V2LegacySearchImport({
  candidates,
  savedSearches,
  japanese,
  onImport,
}: V2LegacySearchImportProps) {
  const [drafts, setDrafts] = useState<Record<string, LegacySearchDraft>>({});
  const [statuses, setStatuses] = useState<Record<string, LegacyImportStatus | undefined>>({});

  if (!candidates.length) return null;

  return (
    <details className="v2-search__legacy">
      <summary>{japanese ? "以前の保存検索" : "Earlier saved searches"}</summary>
      <p className="v2-search__filter-note">
        {japanese
          ? "必要な検索だけ、現在の保存一覧に追加できます。"
          : "Add only the searches you need to the current saved list."}
      </p>
      <ul className="v2-search__legacy-list">
        {candidates.map((candidate, index) => {
          const rowKey = `${candidate.id}:${index}`;
          const draft = drafts[rowKey] ?? { label: candidate.label, query: candidate.query };
          const plan = planLegacyHubSearchImport(savedSearches, draft);
          const storedStatus = statuses[rowKey];
          const status = plan.status === "duplicate" && storedStatus === "imported"
            ? "imported"
            : plan.status === "imported"
              ? storedStatus === "storage_error" ? "storage_error" : null
              : plan.status;
          const queryTooLong = draft.query.length > 100;
          const canImport = plan.status === "imported";
          const labelId = `v2-legacy-search-${index}-label`;
          const queryId = `v2-legacy-search-${index}-query`;

          const updateDraft = (field: keyof LegacySearchDraft, value: string) => {
            setDrafts((current) => ({
              ...current,
              [rowKey]: { ...draft, [field]: value },
            }));
            setStatuses((current) => {
              if (!(rowKey in current)) return current;
              const next = { ...current };
              delete next[rowKey];
              return next;
            });
          };

          const importSearch = () => {
            const nextPlan = planLegacyHubSearchImport(savedSearches, draft);
            if (nextPlan.status !== "imported") {
              setStatuses((current) => ({ ...current, [rowKey]: nextPlan.status }));
              return;
            }
            const result = onImport({ query: draft.query, label: draft.label });
            setStatuses((current) => ({ ...current, [rowKey]: result }));
          };

          const message = status ? statusMessage(status, japanese, queryTooLong) : null;

          return (
            <li className="v2-search__legacy-item" key={rowKey}>
              <div className="v2-search__filter-field">
                <label htmlFor={labelId}>{japanese ? `名前（${index + 1}）` : `Name (${index + 1})`}</label>
                <input
                  id={labelId}
                  name={`legacy-search-${index}-label`}
                  type="text"
                  maxLength={32}
                  value={draft.label}
                  onChange={(event) => updateDraft("label", event.target.value)}
                />
              </div>
              <div className="v2-search__filter-field">
                <label htmlFor={queryId}>{japanese ? `検索語（${index + 1}）` : `Search term (${index + 1})`}</label>
                <input
                  id={queryId}
                  name={`legacy-search-${index}-query`}
                  type="text"
                  maxLength={100}
                  value={draft.query}
                  onChange={(event) => updateDraft("query", event.target.value)}
                />
              </div>
              <button
                type="button"
                className="v2-toggle v2-toggle--text"
                disabled={!canImport}
                onClick={importSearch}
              >
                {japanese ? "保存一覧に追加" : "Add to saved searches"}
              </button>
              {status ? (
                <p className="v2-search__filter-note" role={status === "storage_error" ? "alert" : "status"}>
                  {message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
