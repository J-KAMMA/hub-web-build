export function formatRelativeJst(iso: string): string {
  const date = new Date(iso);

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo"
  }).format(date);
}

export function clsx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
