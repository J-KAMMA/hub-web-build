/**
 * ウォレット要求の失敗を、呼び出し側が区別できる形へ落とす。
 *
 * `docs/mobile-wallet-bridge.md`「失敗と中断の契約」に対応する。
 * **断られたのか壊れているのかを区別できないと、断った人に再試行を迫る画面ができる。**
 * その1点のためにこの層がある。
 *
 * 番号は EIP-1193 と EIP-1474 のものだけを使い、独自の番号を作らない。
 */
export type WalletRequestFailure =
  /** 人が確認画面で断った。再試行を勧めない。 */
  | { kind: "rejected"; code: 4001 }
  /** 許可されていないオリジン。橋自体が出てはいけない状態。 */
  | { kind: "unauthorized"; code: 4100 }
  /** 未対応のメソッド。呼び出し側は代替手段へ落ちてよい。 */
  | { kind: "unsupported"; code: 4200 }
  /** 許可リストに無いチェーン。追加を促さない。 */
  | { kind: "unknown-chain"; code: 4902 }
  /** 引数が不正または大きすぎる。直して出し直す。 */
  | { kind: "invalid-params"; code: -32602 }
  /** 署名器がまだ繋がっていない。故障ではないので言い方を変える。 */
  | { kind: "not-ready"; code: null }
  /** 確認画面や端末鍵が使えない。署名を諦める。 */
  | { kind: "failed"; code: number | null };

const CODE_KINDS = new Map<number, WalletRequestFailure["kind"]>([
  [4001, "rejected"],
  [4100, "unauthorized"],
  [4200, "unsupported"],
  [4902, "unknown-chain"],
  [-32602, "invalid-params"],
]);

function readCode(reason: unknown): number | null {
  if (typeof reason !== "object" || reason === null) return null;
  const direct = (reason as { code?: unknown }).code;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  // ブリッジによっては元のエラーを包んで返す。1段だけ中を見る。
  const nested = (reason as { cause?: unknown }).cause;
  if (typeof nested === "object" && nested !== null) {
    const inner = (nested as { code?: unknown }).code;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  return null;
}

function readMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (typeof reason === "object" && reason !== null) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function classifyWalletRequestError(reason: unknown): WalletRequestFailure {
  const message = readMessage(reason);
  // モバイルのネイティブウォレットは入口だけ先に出て、署名器が繋がるまで
  // 全メソッドが wallet_not_ready を返す。これを故障と扱うと再試行を迫る。
  if (message.includes("wallet_not_ready")) return { kind: "not-ready", code: null };

  const code = readCode(reason);
  if (code !== null) {
    const kind = CODE_KINDS.get(code);
    if (kind === "rejected") return { kind, code: 4001 };
    if (kind === "unauthorized") return { kind, code: 4100 };
    if (kind === "unsupported") return { kind, code: 4200 };
    if (kind === "unknown-chain") return { kind, code: 4902 };
    if (kind === "invalid-params") return { kind, code: -32602 };
  }

  // 番号を出さないブリッジのために、文言からも拒否だけは拾う。
  // 拒否を故障と読み違える害のほうが、その逆より大きい。
  if (/user rejected|user denied|rejected by user/i.test(message)) {
    return { kind: "rejected", code: 4001 };
  }
  return { kind: "failed", code };
}

/** 接続の失敗を画面へ出す文。断られた場合に再試行を促さない。 */
export function walletConnectErrorMessage(reason: unknown): string {
  const failure = classifyWalletRequestError(reason);
  switch (failure.kind) {
    case "rejected":
      return "ウォレットへの接続を許可しませんでした。";
    case "unauthorized":
      return "このページからはウォレットを利用できません。";
    case "not-ready":
      return "この端末のウォレットは準備中です。外部ウォレットをご利用ください。";
    case "unsupported":
      return "このウォレットは接続に対応していません。";
    default:
      return "ウォレットを確認できませんでした。時間をおいて、もう一度お試しください。";
  }
}

/** チェーン切り替えの失敗を画面へ出す文。追加を促さない。 */
export function walletSwitchChainErrorMessage(reason: unknown): string {
  const failure = classifyWalletRequestError(reason);
  switch (failure.kind) {
    case "rejected":
      return "ネットワークの切り替えを許可しませんでした。";
    case "unknown-chain":
      return "このウォレットでは、このネットワークを利用できません。";
    case "unauthorized":
      return "このページからはウォレットを利用できません。";
    case "not-ready":
      return "この端末のウォレットは準備中です。";
    default:
      return "ネットワークを切り替えられませんでした。";
  }
}

/** 断られただけの失敗か。再試行の導線を出すかの判断に使う。 */
export function isWalletRejection(reason: unknown): boolean {
  return classifyWalletRequestError(reason).kind === "rejected";
}
