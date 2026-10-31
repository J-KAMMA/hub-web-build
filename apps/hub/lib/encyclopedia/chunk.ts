export interface TextChunk { chunkIndex: number; headingPath: string[]; textContent: string; startOffset: number; endOffset: number; }
export function chunkText(text: string, maxTokens: number, overlapTokens: number): TextChunk[] {
  if (maxTokens <= 0 || overlapTokens < 0 || overlapTokens >= maxTokens) throw new Error("Invalid chunk settings.");
  const maxChars = maxTokens * 4; const overlapChars = overlapTokens * 4; const chunks: TextChunk[] = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) { const window = text.slice(start, end); const boundary = Math.max(window.lastIndexOf("。"), window.lastIndexOf(". "), window.lastIndexOf("\n\n")); if (boundary >= maxChars * 0.55) end = start + boundary + 1; }
    const raw = text.slice(start, end); const content = raw.trim(); const leading = raw.indexOf(content);
    if (content) chunks.push({ chunkIndex: chunks.length, headingPath: [], textContent: content, startOffset: start + Math.max(0, leading), endOffset: start + Math.max(0, leading) + content.length });
    if (end >= text.length) break; const next = Math.max(start + 1, end - overlapChars); start = next;
  }
  return chunks;
}
