"use client";

import React, { Fragment, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\$[^$\n]+\$|\[[^\]\n]+\]\(https:\/\/[^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const value = match[0];
    const link = /^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/.exec(value);
    if (link) nodes.push(<a key={`${key}-${index}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}<ExternalLink aria-hidden="true" /></a>);
    else if (value.startsWith("**")) nodes.push(<strong key={`${key}-${index}`}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("`")) nodes.push(<code key={`${key}-${index}`}>{value.slice(1, -1)}</code>);
    else nodes.push(<span className="ai-markdown__math-inline" key={`${key}-${index}`}>{value.slice(1, -1)}</span>);
    cursor = index + value.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = React.useState(false);
  return <div className="ai-markdown__code"><header><span>{language || "text"}</span><button type="button" onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "コピー済み" : "コピー"}</button></header><pre><code>{code}</code></pre></div>;
}

export function AiMessageContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const citations = Array.from(new Map(Array.from(content.matchAll(/https:\/\/[^\s)\]]+/g), (match) => {
    try { const url = new URL(match[0]); return [url.href, { href: url.href, host: url.hostname.replace(/^www\./, "") }]; } catch { return [match[0], null]; }
  }).filter((entry): entry is [string, { href: string; host: string }] => Boolean(entry[1]))).values()).slice(0, 8);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      blocks.push(<CodeBlock key={`code-${index}`} language={language} code={code.join("\n")} />);
    } else if (line.trim() === "$$") {
      const formula: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "$$") formula.push(lines[index++]);
      blocks.push(<div className="ai-markdown__math" key={`math-${index}`}>{formula.join("\n")}</div>);
    } else if (/^#{1,3}\s+/.test(line)) {
      const match = /^(#{1,3})\s+(.+)$/.exec(line)!;
      const children = inline(match[2], `heading-${index}`);
      blocks.push(match[1].length === 1 ? <h2 key={`h-${index}`}>{children}</h2> : <h3 key={`h-${index}`}>{children}</h3>);
    } else if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-*]\s+/, ""));
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `li-${index}-${itemIndex}`)}</li>)}</ul>);
      index -= 1;
    } else if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\d+\.\s+/, ""));
      blocks.push(<ol key={`ordered-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `oli-${index}-${itemIndex}`)}</li>)}</ol>);
      index -= 1;
    } else if (line.includes("|") && lines[index + 1] && /^\s*\|?\s*:?-+/.test(lines[index + 1])) {
      const tableLines = [line];
      let tableCursor = index + 2;
      while (tableCursor < lines.length && lines[tableCursor].includes("|") && lines[tableCursor].trim()) tableLines.push(lines[tableCursor++]);
      const rows: string[][] = tableLines.map((row) => row.split("|").map((cell) => cell.trim()).filter(Boolean));
      const bodyCount = rows.length - 1;
      blocks.push(<div className="ai-markdown__table" key={`table-${index}`}><table><thead><tr>{rows[0].map((cell, cellIndex) => <th key={cellIndex}>{inline(cell, `th-${cellIndex}`)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell, `td-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>);
      index += bodyCount + 1;
    } else if (line.trim()) {
      const paragraph = [line];
      while (index + 1 < lines.length && lines[index + 1].trim() && !/^(#{1,3}\s+|```|[-*]\s+|\d+\.\s+|\$\$)/.test(lines[index + 1])) paragraph.push(lines[++index]);
      blocks.push(<p key={`p-${index}`}>{paragraph.map((part, partIndex) => <Fragment key={partIndex}>{partIndex ? <br /> : null}{inline(part, `p-${index}-${partIndex}`)}</Fragment>)}</p>);
    }
    index += 1;
  }

  return <div className="ai-markdown">{blocks}{citations.length > 0 ? <aside className="ai-markdown__sources" aria-label="引用元"><strong>引用・リンク</strong><div>{citations.map((citation, citationIndex) => <a href={citation.href} target="_blank" rel="noreferrer" key={citation.href}><span>{citationIndex + 1}</span><small>{citation.host}</small><ExternalLink aria-hidden="true" /></a>)}</div></aside> : null}</div>;
}
