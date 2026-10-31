"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/* マガジンの公開ページで、記事の書き手本人にだけ出す「このマガジンから外す」。 */
export function V2MagazineAuthorRemove({ magazineId, articleId, japanese = true }: { magazineId: string; articleId: string; japanese?: boolean }) {
  const t = (ja: string, en: string) => (japanese ? ja : en);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm(t("自分の記事をこのマガジンから外します。", "Remove your article from this magazine?"))) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/articles/magazines/${encodeURIComponent(magazineId)}/articles?articleId=${encodeURIComponent(articleId)}&as=author`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(typeof data.error === "string" ? data.error : t("外せませんでした。", "Could not remove."));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("外せませんでした。", "Could not remove."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="v2-button v2-button--text" type="button" disabled={busy} onClick={() => void remove()}>
        {t("このマガジンから外す", "Remove from this magazine")}
      </button>
      {error ? <span className="v2-magazine-manager__error" role="alert">{error}</span> : null}
    </>
  );
}
