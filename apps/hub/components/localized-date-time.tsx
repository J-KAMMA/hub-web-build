"use client";

import { useEffect, useState } from "react";

export function LocalizedDateTime({ value, withSeconds = false }: { value: string; withSeconds?: boolean }) {
  const date = new Date(value);
  const [label, setLabel] = useState(() => new Intl.DateTimeFormat("en", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {})
  }).format(date) + " UTC");

  useEffect(() => {
    setLabel(new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {})
    }).format(date));
  }, [value, withSeconds]);

  return <time dateTime={value} title={date.toISOString()} suppressHydrationWarning>{label}</time>;
}
