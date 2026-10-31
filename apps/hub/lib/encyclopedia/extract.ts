import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ExtractedDocument { title: string | null; canonicalUrl: string | null; text: string; headings: Array<{ level: number; text: string }>; language: string | null; publishedAt: string | null; authors: string[]; }
export function extractHtml(html: string, sourceUrl: string): ExtractedDocument {
  const dom = new JSDOM(html, { url: sourceUrl }); const doc = dom.window.document;
  doc.querySelectorAll("script,style,noscript,nav,footer,aside,form,[role='navigation'],.advertisement,.advert,.related").forEach((node) => node.remove());
  const headings = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((node) => ({ level: Number(node.tagName.slice(1)), text: (node.textContent ?? "").replace(/\s+/g, " ").trim() })).filter((h) => h.text);
  const canonicalUrl = (doc.querySelector("link[rel='canonical']") as HTMLLinkElement | null)?.href ?? null;
  const publishedAt = (doc.querySelector("meta[property='article:published_time'],meta[name='date'],time[datetime]") as HTMLMetaElement | null)?.content ?? doc.querySelector("time[datetime]")?.getAttribute("datetime") ?? null;
  const authorValues = [...doc.querySelectorAll("meta[name='author'],meta[property='article:author']")].map((node) => node.getAttribute("content")?.trim()).filter((value): value is string => Boolean(value));
  const article = new Readability(doc.cloneNode(true) as Document).parse();
  const text = (article?.textContent ?? doc.body?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No readable text could be extracted.");
  return { title: article?.title?.trim() || doc.title.trim() || null, canonicalUrl, text, headings, language: doc.documentElement.lang || null, publishedAt, authors: [...new Set(authorValues)] };
}
