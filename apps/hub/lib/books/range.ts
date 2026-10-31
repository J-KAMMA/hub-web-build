import type { R2Range } from "@cloudflare/workers-types";

export function parseBookRangeHeader(value: string | null): R2Range | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { suffix } : null;
  }
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  if (!match[2]) return { offset };
  const end = Number(match[2]);
  return Number.isSafeInteger(end) && end >= offset ? { offset, length: end - offset + 1 } : null;
}

export function bookRangeIsSatisfiable(range: R2Range, size: number) {
  if (size <= 0) return false;
  if ("suffix" in range) return range.suffix > 0;
  return (range.offset ?? 0) < size;
}
