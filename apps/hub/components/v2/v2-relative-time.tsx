"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/v2-time";

export function V2RelativeTime({ value, locale }: { value: string; locale: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return <time dateTime={iso} title={iso}>{ready ? relativeTime(value, locale) : iso.slice(0, 10)}</time>;
}
