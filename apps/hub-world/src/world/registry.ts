/**
 * どのサーバが在り、誰が建て、どこへ繋ぐか。
 *
 * **第三者が建てる形にすると、繋ぎ先を人が手で貼ることになる。** それを避ける
 * ための名簿。ここは規則だけを持ち、置き場（D1）も伝送路も読まない。
 *
 * ## 建てさせるという選択が持つもの
 *
 * サーバの主は**移動の審判**なので、その世界に居る間の位置も発言も全部見える。
 * なりすましもできる。**これは欠陥ではなく、建てさせるという選択そのもの。**
 * 隠せないので、名簿は「誰が建てたか」を必ず持ち、入る前に出せるようにする。
 */

/** サーバの名前。**宛先の一部になる**ので、緩めない。 */
const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/u;

export const REGISTRY_LIMITS = {
  /** 表示名の長さ。 */
  titleLength: 40,
  /** 説明の長さ。 */
  aboutLength: 200,
  /** 1人が建てられる数。**無制限だと名簿が埋まる。** */
  perOperator: 5,
  /**
   * これだけ届いたら、人に見てもらう列へ上げる。
   *
   * **下ろすのは人。** 一度は「5件で自動的に下ろす」形にしたが、外した。
   * Hub はサーバの中を見られないので、通報は確かめようのない申し立てになる。
   * それで機械が下ろすと、5口座を揃えれば他人の店を消せる道具になる。
   *
   * ここは「急いで見る」の目印であって、処分ではない。
   */
  reportsToNotice: 3
};

/**
 * 出せる状態。
 *
 * **届け出たら、そのまま公開になる。** 出す前に1つずつ見る形は数が増えると
 * 回らないので、そちらを選んだ。代わりに**出た後に下ろせる**ようにしてある
 * （通報が REGISTRY_LIMITS.reportsToSuspend 件で停止）。
 *
 * 「待ち」は、下ろしたものを戻す途中などに使う。
 */
export type ServerStatus = "待ち" | "公開" | "停止";

export type WorldServer = {
  /** 名前。宛先 `jkamma-hub-world:<name>` の後半になる。 */
  name: string;
  title: string;
  about: string;
  /** 建てた人（Hub の表示名と結び付く識別子）。**必ず持つ。** */
  operator: string;
  /** 繋ぎ先。wss のみ。 */
  address: string;
  status: ServerStatus;
  at: number;
};

export function isServerName(value: unknown): value is string {
  return typeof value === "string" && NAME.test(value);
}

/**
 * 繋ぎ先を検める。**通らなければ null。**
 *
 * - `wss:` だけ。平文だと、署名した許可が経路上の誰にでも取れる
 * - 利用者名も問い合わせも断片も持たせない。**繋ぎ先に秘密を混ぜさせない**
 * - 手元向きの名前を断る。名簿に載せる先が誰かの手元を指していてはいけない
 */
export function readAddress(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "wss:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && !/^\/[A-Za-z0-9/_-]{0,60}$/u.test(url.pathname)) return null;

  const host = url.hostname.toLowerCase();
  // **手元と内側を断る。** 名簿は他人が読む。他人の手元を指させない。
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.some((one) => !Number.isInteger(one) || one > 255)) return null;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return null;
    if (a === 172 && b >= 16 && b <= 31) return null;
    if (a === 192 && b === 168) return null;
    if (a === 169 && b === 254) return null;
  }
  if (host.includes(":")) return null; // 生の IPv6 は通さない（内側を書きやすい）
  if (!host.includes(".")) return null;
  return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, ""));
}

/** 表示する文字を整える。**他人が書いた文字列**として扱う。 */
export function cleanLabel(raw: unknown, limit: number): string {
  const text = typeof raw === "string" ? raw : "";
  return [...text]
    .filter((one) => {
      const code = one.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f &&
        code !== 0x200b && code !== 0x200e && code !== 0x200f &&
        !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069) &&
        code !== 0xfeff;
    })
    .slice(0, limit)
    .join("")
    .trim();
}

export type Registered =
  | { ok: true; server: WorldServer }
  | { ok: false; reason: string };

/**
 * 名簿へ載せる形にする。
 *
 * **断る理由は返す。** 建てる人が直せるものなので、黙って落とすと直しようがない。
 */
export function register(
  wish: { name: unknown; title: unknown; about?: unknown; address: unknown },
  operator: string,
  mine: readonly WorldServer[],
  at: number
): Registered {
  if (!isServerName(wish.name)) {
    return { ok: false, reason: "名前は英小文字・数字・- だけ、31文字まで" };
  }
  const address = readAddress(wish.address);
  if (!address) return { ok: false, reason: "繋ぎ先は wss:// の公開の名前だけ" };
  const title = cleanLabel(wish.title, REGISTRY_LIMITS.titleLength);
  if (!title) return { ok: false, reason: "表示名が要ります" };
  if (!operator) return { ok: false, reason: "建てた人が分かりません" };

  const held = mine.filter((one) => one.operator === operator && one.name !== wish.name);
  if (held.length >= REGISTRY_LIMITS.perOperator) {
    return { ok: false, reason: `建てられるのは${REGISTRY_LIMITS.perOperator}つまでです` };
  }
  return {
    ok: true,
    server: {
      name: wish.name,
      title,
      about: cleanLabel(wish.about, REGISTRY_LIMITS.aboutLength),
      operator,
      address,
      // **届け出たら出す。** 見る人を挟まない代わりに、通報で下ろせる。
      status: "公開",
      at
    }
  };
}

/** 一覧に出すもの。**公開だけ。** */
export function listed(servers: readonly WorldServer[]): WorldServer[] {
  return servers.filter((one) => one.status === "公開");
}

/**
 * 通報を、人で数える。
 *
 * **数だけで持たない。** 1人が繰り返し押して積み上げられる。建てた本人の
 * 通報も数えない（自分で下ろしたいなら、届け出を消せばよい）。
 */
export function countReporters(
  server: WorldServer,
  reporters: readonly string[]
): number {
  return new Set(reporters.filter((one) => one && one !== server.operator)).size;
}

/**
 * 急いで見るべきか。**処分ではない。**
 *
 * 数が届いても、状態は変わらない。**下ろすのは人の判断。**
 */
export function needsLooking(server: WorldServer, reporters: readonly string[]): boolean {
  return server.status === "公開" &&
    countReporters(server, reporters) >= REGISTRY_LIMITS.reportsToNotice;
}

/**
 * 記録から読み直す。**読めない行は捨てて、残りは使う。**
 *
 * 1行が読めないだけで名簿が空になると、書き換えられた1行で全部が消える。
 */
export function readServers(raw: unknown): WorldServer[] {
  if (!Array.isArray(raw)) return [];
  const found: WorldServer[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const one = value as Record<string, unknown>;
    if (!isServerName(one.name) || seen.has(one.name)) continue;
    const address = readAddress(one.address);
    if (!address) continue;
    if (typeof one.operator !== "string" || !one.operator) continue;
    const title = cleanLabel(one.title, REGISTRY_LIMITS.titleLength);
    if (!title) continue;
    const status = one.status;
    if (status !== "待ち" && status !== "公開" && status !== "停止") continue;
    seen.add(one.name);
    found.push({
      name: one.name,
      title,
      about: cleanLabel(one.about, REGISTRY_LIMITS.aboutLength),
      operator: one.operator,
      address,
      status,
      at: Number.isFinite(one.at) ? (one.at as number) : 0
    });
  }
  return found;
}
