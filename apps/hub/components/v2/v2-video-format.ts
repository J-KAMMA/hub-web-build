/*
 * 動画の回数・日付の表記（SPEC 4.4）。サーバーでもクライアントでも呼ぶので "use client" を付けない。
 * 日本語は万・億で詰める（1万未満は桁区切り）。英語は compact。
 */
export function formatViews(count: number, ja: boolean): string {
  const n = Math.max(0, Math.floor(count));
  if (!ja) return `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)} views`;
  const trim = (value: number) => (Math.round(value * 10) / 10).toString();
  if (n >= 100_000_000) return `${trim(n / 100_000_000)}億回視聴`;
  if (n >= 10_000) return `${trim(n / 10_000)}万回視聴`;
  return `${n.toLocaleString("ja-JP")}回視聴`;
}

/* 「3年前」「2か月前」。1週間未満は日・時間・分。 */
export function agoLabel(value: string | undefined, ja: boolean, now = Date.now()): string {
  const then = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const units: [number, string, string][] = [
    [31_536_000, "年", "y"], [2_592_000, "か月", "mo"], [604_800, "週間", "w"], [86_400, "日", "d"], [3600, "時間", "h"], [60, "分", "m"],
  ];
  for (const [size, jaUnit, enUnit] of units) {
    if (seconds >= size) {
      const amount = Math.floor(seconds / size);
      return ja ? `${amount}${jaUnit}前` : `${amount}${enUnit} ago`;
    }
  }
  return ja ? "たった今" : "just now";
}
