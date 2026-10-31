"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Expand, ExternalLink } from "lucide-react";

import type { HubFixedLayoutBook } from "@/lib/books/catalog";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

type Availability = "checking" | "ready" | "missing" | "unavailable";

export function BookReader({ book, volumeNumber }: { book: HubFixedLayoutBook; volumeNumber: number }) {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [availability, setAvailability] = useState<Availability>("checking");
  const volume = book.volumes.find((candidate) => candidate.number === volumeNumber)!;
  const fileUrl = `/api/books/${encodeURIComponent(book.id)}/volumes/${volume.number}/file`;
  const previous = book.volumes.find((candidate) => candidate.number === volume.number - 1);
  const next = book.volumes.find((candidate) => candidate.number === volume.number + 1);

  useEffect(() => {
    const controller = new AbortController();
    setAvailability("checking");
    fetch(fileUrl, { method: "HEAD", cache: "no-store", signal: controller.signal })
      .then((response) => setAvailability(response.ok ? "ready" : response.status === 404 ? "missing" : "unavailable"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAvailability("unavailable");
      });
    window.localStorage.setItem(`hub.books.${book.id}.last-volume`, String(volume.number));
    window.localStorage.setItem(`hub.books.${book.id}.last-opened-at`, new Date().toISOString());
    return () => controller.abort();
  }, [book.id, fileUrl, volume.number]);

  return (
    <section className="book-reader" aria-label={`${book.title} ${volume.title}`}>
      <header className="book-reader__toolbar">
        <div>
          <Link href={hubSurfacePath(surface, "/books")}>本棚</Link>
          <span aria-hidden="true">/</span>
          <strong>{book.title} {volume.title}</strong>
          <small className="book-reader__mode">固定レイアウト</small>
        </div>
        <div className="book-reader__actions">
          <label>
            <span>巻</span>
            <select value={volume.number} onChange={(event) => { window.location.href = `/books/${book.id}/${event.target.value}`; }}>
              {book.volumes.map((candidate) => <option key={candidate.number} value={candidate.number}>{candidate.title}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void frameRef.current?.requestFullscreen()} disabled={availability !== "ready"}>
            <Expand aria-hidden="true" /> 全画面
          </button>
        </div>
      </header>

      <div className="book-reader__frame" ref={frameRef}>
        {availability === "ready" ? (
          <iframe src={`${fileUrl}#view=FitH`} title={`${book.title} ${volume.title} 読書画面`} />
        ) : availability === "checking" ? (
          <div className="book-reader__state" role="status"><strong>本を準備しています</strong><p>配信データを確認しています。</p></div>
        ) : (
          <div className="book-reader__state" role="status">
            <strong>{availability === "missing" ? "この巻はまだHubに収録されていません" : "本を読み込めませんでした"}</strong>
            <p>公式配布元から入手できます。Hubには公式配布データだけを収録します。</p>
            <a href={volume.officialDownloadUrl} target="_blank" rel="noopener noreferrer">公式ZIPを開く <ExternalLink aria-hidden="true" /></a>
          </div>
        )}
      </div>

      <nav className="book-reader__pagination" aria-label="巻を移動">
        {previous ? <Link href={hubSurfacePath(surface, `/books/${book.id}/${previous.number}`)}>← {previous.title}</Link> : <span />}
        {next ? <Link href={hubSurfacePath(surface, `/books/${book.id}/${next.number}`)}>{next.title} →</Link> : <span />}
      </nav>

      <footer className="book-reader__credit">
        <strong>{book.title}　{book.author}</strong>
        <p>配布元: <a href={book.sourceSiteUrl} target="_blank" rel="noopener noreferrer">{book.sourceSiteName}</a>　
          <a href={book.licenseUrl} target="_blank" rel="noopener noreferrer">利用規約</a></p>
        <small>{book.reportingNotice}</small>
        {book.distributionNotice ? <p className="book-reader__rights-notice" role="note">{book.distributionNotice}</p> : null}
        {volume.rightsNotice ? <p className="book-reader__rights-notice" role="note">{volume.rightsNotice} {volume.thirdPartyRightsReferences?.join("、")}</p> : null}
      </footer>
    </section>
  );
}
