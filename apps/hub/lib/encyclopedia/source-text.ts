import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractHtml } from "./extract";

/*
 * Turning fetched bytes into the text a claim can be quoted from.
 *
 * Four call sites were each deciding this for themselves with the same line —
 * HTML through the extractor, anything else decoded as UTF-8 — which was fine
 * while every source was a web page. It stops being fine the moment a
 * government publication is a PDF: the bytes decode to binary noise that reads
 * as a few thousand characters of nothing, so the page passes the usable-length
 * check and then yields no claim anyone can verify. The best public-domain
 * blockchain reference there is, NIST IR 8202, is a PDF.
 *
 * pdftotext does the conversion. It ships with Git for Windows and with
 * poppler-utils elsewhere; when it is missing the failure says so rather than
 * returning the binary.
 */

export const SOURCE_TEXT_MIME = new Set(["text/html", "application/xhtml+xml", "text/plain", "application/pdf"]);

export function isPdf(mimeType: string) {
  return mimeType.split(";")[0].trim().toLowerCase() === "application/pdf";
}

function pdfToText(body: Uint8Array) {
  const scratch = mkdtempSync(join(tmpdir(), "hubpedia-pdf-"));
  const pdfPath = join(scratch, "source.pdf");
  try {
    writeFileSync(pdfPath, body);
    /* -layout keeps column structure, which matters for a standards document
     * where a definition and its term sit on the same line. */
    const result = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("pdftotext is not installed; PDF sources cannot be read without it.");
    }
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`pdftotext exited ${result.status}: ${(result.stderr ?? "").slice(0, 200)}`);
    return result.stdout ?? "";
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function sourceText(fetched: { body: Uint8Array; mimeType: string; finalUrl: string }) {
  if (isPdf(fetched.mimeType)) return pdfToText(fetched.body);
  const decoded = new TextDecoder().decode(fetched.body);
  const mimeType = fetched.mimeType.split(";")[0].trim().toLowerCase();
  return mimeType === "text/html" || mimeType === "application/xhtml+xml"
    ? extractHtml(decoded, fetched.finalUrl).text
    : decoded;
}
