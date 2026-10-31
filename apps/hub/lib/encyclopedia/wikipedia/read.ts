import type { D1Database } from "@cloudflare/workers-types";

import { readVerifiedObject, type LedgerObjectStore } from "../ledger/object-store";

/*
 * Reading the Japanese Wikipedia base layer for an article page. A Hub article (published revision or seed)
 * always takes precedence: callers ask here only when they found none. Reads fail closed: a missing object or a
 * hash mismatch gives null, never an empty body.
 */

export interface WikipediaBaseArticle {
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  revisionId: number;
  revisionTimestamp: string;
  sourceUrl: string;
  historyUrl: string;
  license: "CC-BY-SA-4.0";
  verificationStatus: "unverified" | "verified" | "superseded";
}

export type WikipediaBaseLookup =
  | { kind: "article"; article: WikipediaBaseArticle }
  | { kind: "redirect"; slug: string };

type Row = {
  slug: string; title: string; summary: string; revision_id: number; revision_timestamp: string; body_object_key: string; body_sha256: string;
  source_url: string; history_url: string; verification_status: WikipediaBaseArticle["verificationStatus"];
};

const COLUMNS = "slug, title, summary, revision_id, revision_timestamp, body_object_key, body_sha256, source_url, history_url, verification_status";

export async function lookupWikipediaBase(db: D1Database, objects: LedgerObjectStore | undefined, slug: string): Promise<WikipediaBaseLookup | null> {
  try {
    const row = await db.prepare(`SELECT ${COLUMNS} FROM hubpedia_wikipedia_articles WHERE slug=?`).bind(slug).first<Row>();
    if (!row) {
      const alias = await db.prepare("SELECT target_slug FROM hubpedia_wikipedia_aliases WHERE alias_slug=?").bind(slug).first<{ target_slug: string }>();
      if (!alias || alias.target_slug === slug) return null;
      const target = await db.prepare("SELECT 1 AS present FROM hubpedia_wikipedia_articles WHERE slug=?").bind(alias.target_slug).first<{ present: number }>();
      return target ? { kind: "redirect", slug: alias.target_slug } : null;
    }
    const bodyMarkdown = await readVerifiedObject(objects, { key: row.body_object_key, sha256: row.body_sha256 });
    return {
      kind: "article",
      article: {
        slug: row.slug, title: row.title, summary: row.summary, bodyMarkdown, revisionId: row.revision_id, revisionTimestamp: row.revision_timestamp,
        sourceUrl: row.source_url, historyUrl: row.history_url, license: "CC-BY-SA-4.0", verificationStatus: row.verification_status,
      },
    };
  } catch {
    return null;
  }
}
