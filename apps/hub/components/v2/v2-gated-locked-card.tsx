"use client";

import { useEffect, useRef, useState } from "react";

import type { AccessGateTargetType, PublicAccessGate } from "@/lib/access-gates/types";
import { STALE_ACCESS_NOTE, VIDEO_REFERENCE_NOTE, matchLabel, rawToHuman, summarizeCondition } from "@/components/v2/v2-access-gate-shared";
import { GohoTokenPurchasePanel, gohoTokenPurchaseForGate } from "@/components/v2/v2-gate-gohotoken-purchase";
import { EXTERNAL_ACQUISITION_LABEL, fetchTokenMeta, passHeadline, tokenDisplayName } from "@/lib/access-gates/token-pass";
import { getGohoTokenPurchaseApi } from "@/lib/gohotoken/api";

import "./v2-access-gates.css";

/*
 * 鍵付きカード。本文はサーバーで外されている前提で、ここは題・条件・操作だけを描く。
 * 紐付け（レーンC）: { gate, status } を渡す。再確認には targetType / targetId を足す。
 * 外部の入手先リンクは作成者の指定として示すだけ。並べない・比べない・既定で選ばない。
 * その指定が GohoToken の販売ページなら、同じ販売をハブの中で買える（販売元は GohoToken）。
 */

export type GatedLockedCardProps = {
  gate: PublicAccessGate;
  status: "locked" | "unavailable";
  title?: string;
  /** 題がすぐ上に出ている画面（記事の本文の位置）では、カードの中で繰り返さない */
  hideTitle?: boolean;
  targetType?: AccessGateTargetType;
  targetId?: string;
  /** YouTube などの外部参照の動画か */
  externalVideo?: boolean;
  /** 再確認で通ったあと、親が本文を取り直す */
  onUnlocked?: () => void;
};

const WALLET_LINK_HREF = "/v2/account/payment";

/* 1ページに鍵付きカードが並んでも /api/wallet/links は1回だけ読む。 */
let walletLinksRead: Promise<boolean | null> | null = null;
function readHasWallet(): Promise<boolean | null> {
  if (walletLinksRead) return walletLinksRead;
  const result = fetch("/api/wallet/links", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json().catch(() => null)) as { links?: unknown } | null;
      return Array.isArray(payload?.links) ? payload.links.length > 0 : null;
    })
    .catch(() => null)
    .finally(() => {
      walletLinksRead = null;
    });
  walletLinksRead = result;
  return result;
}

/* 条件が1つのとき、トークン名を一度だけ読む（同じトークンの鍵付きカードが並んでも1回）。失敗は覚えない。 */
const tokenNames = new Map<string, Promise<string | null>>();
function readTokenName(key: string, load: () => Promise<string | null>): Promise<string | null> {
  const cached = tokenNames.get(key);
  if (cached) return cached;
  const promise = load().then((name) => {
    if (name === null) tokenNames.delete(key);
    return name;
  });
  tokenNames.set(key, promise);
  return promise;
}

type Recheck = "idle" | "checking" | "denied" | "unavailable" | "limited" | "missing";
type CheckOutcome = "allowed" | "denied" | "unavailable" | "limited" | "missing";

/* 戻ってきたときの自動再確認：10秒に1回まで、リンクを開いてから10分まで。 */
export const AUTO_RECHECK_MIN_GAP_MS = 10_000;
export const AUTO_RECHECK_WINDOW_MS = 10 * 60_000;
/* 購入直後の再確認が通らなかったときの待ち。サーバーは「確認不可」を覚えないので回数は少なく。 */
export const PURCHASE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

export function V2GatedLockedCard({ gate, status, title, hideTitle = false, targetType, targetId, externalVideo = false, onUnlocked }: GatedLockedCardProps) {
  const [recheck, setRecheck] = useState<Recheck>("idle");
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  const opened = useRef(false);
  const mounted = useRef(true);
  const armedAt = useRef<number | null>(null);
  const lastAutoAt = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void readHasWallet().then((value) => {
      if (active) setHasWallet(value);
    });
    return () => {
      active = false;
    };
  }, []);

  /* 開けるかどうかはサーバーの確認だけが決める。ここは結果を受け取って親に知らせるだけ。 */
  const runCheck = async (): Promise<CheckOutcome> => {
    if (!targetType || !targetId) return "missing";
    try {
      const response = await fetch("/api/access-gates/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId }),
      });
      if (response.status === 404) return "missing";
      if (response.status === 429) return "limited";
      if (!response.ok) return "unavailable";
      const payload = (await response.json().catch(() => null)) as { allowed?: unknown; outcome?: unknown } | null;
      if (payload?.allowed === true || payload?.outcome === "allowed") {
        if (!opened.current) {
          opened.current = true;
          onUnlocked?.();
        }
        return "allowed";
      }
      return payload?.outcome === "unavailable" ? "unavailable" : "denied";
    } catch {
      return "unavailable";
    }
  };

  const check = async () => {
    if (!targetType || !targetId || recheck === "checking" || opened.current) return;
    setRecheck("checking");
    const outcome = await runCheck();
    if (!mounted.current) return;
    setRecheck(outcome === "allowed" ? "idle" : outcome);
  };

  /* 購入画面からの再確認。通らなければ少し待って数回やり直す。成功の表示だけでは開かない。 */
  const recheckAfterPurchase = async (): Promise<boolean> => {
    if (!targetType || !targetId) return false;
    let outcome = await runCheck();
    if (outcome === "allowed") return true;
    for (const delay of PURCHASE_RETRY_DELAYS_MS) {
      if (outcome === "limited" || outcome === "missing" || !mounted.current || opened.current) break;
      if (mounted.current) setRetrying(true);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!mounted.current || opened.current) break;
      outcome = await runCheck();
      if (outcome === "allowed") break;
    }
    if (mounted.current) setRetrying(false);
    return outcome === "allowed";
  };

  /* 外部の入手先やウォレット連携のリンクを開いたら、戻ってきたときに自動で確かめる。 */
  const arm = () => {
    armedAt.current = Date.now();
  };

  useEffect(() => {
    if (!targetType || !targetId) return;
    const onReturn = () => {
      if (opened.current || inFlight.current || armedAt.current === null) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - armedAt.current > AUTO_RECHECK_WINDOW_MS) {
        armedAt.current = null;
        return;
      }
      if (now - lastAutoAt.current < AUTO_RECHECK_MIN_GAP_MS) return;
      lastAutoAt.current = now;
      inFlight.current = true;
      void readHasWallet().then((value) => {
        if (mounted.current) setHasWallet(value);
      });
      void runCheck()
        .then((outcome) => {
          if (mounted.current && outcome !== "allowed") setRecheck(outcome);
        })
        .finally(() => {
          inFlight.current = false;
        });
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId]);

  const unavailable = status === "unavailable";
  const gohoPurchase = gohoTokenPurchaseForGate(gate, title ?? "");
  const purchase = targetType && targetId ? gohoPurchase : null;
  const single = gate.conditions.length === 1 ? gate.conditions[0]! : null;
  const [tokenName, setTokenName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!single) return;
    const key = `${single.chainId}:${single.contract.toLowerCase()}`;
    const load =
      gohoPurchase && gohoPurchase.saleAddress
        ? async () => {
            // GohoToken の販売ページから。販売のトークンが条件の契約と同じときだけ名前を使う。
            const sale = await getGohoTokenPurchaseApi().getSale({ chainId: gohoPurchase.chainId, saleAddress: gohoPurchase.saleAddress! });
            if (sale.status !== "ok" || sale.value.tokenAddress.toLowerCase() !== single.contract.toLowerCase()) return null;
            return sale.value.tokenName ?? sale.value.tokenSymbol ?? null;
          }
        : async () => {
            const result = await fetchTokenMeta({ kind: single.kind, chainId: single.chainId, contract: single.contract });
            return result.ok ? tokenDisplayName(result.meta) : null;
          };
    void readTokenName(`${gohoPurchase ? "goho" : "meta"}:${key}`, load)
      .then((name) => {
        if (active) setTokenName(name);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.id, gate.version, gate.acquisitionUrl]);

  const headlineAmount = single
    ? single.kind === "erc20"
      ? rawToHuman(single.minRaw, single.decimals)
      : single.kind === "erc1155"
        ? single.minRaw
        : "1"
    : null;
  const headline = !unavailable && tokenName && headlineAmount ? passHeadline(tokenName, headlineAmount) : null;
  const acquisition = gate.acquisitionUrl && /^https:\/\//i.test(gate.acquisitionUrl) ? gate.acquisitionUrl : null;
  /* 次にすることは1つだけ目立たせる。ウォレットが未連携ならその連携、済んでいれば確かめ直し。 */
  const walletFirst = hasWallet === false;
  /* 書き手の説明が見出しと同じなら繰り返さない（自動でつく説明は「USD Coin を 1 枚持っている人」の形） */
  const description = gate.description && !(headline && headline.replace(/\s/g, "").includes(gate.description.replace(/\s/g, "").replace(/人$/, ""))) ? gate.description : null;

  return (
    <article className="v2-gate-card" aria-label="閲覧条件つきのコンテンツ">
      {title && !hideTitle ? <h3 className="v2-gate-card__title">{title}</h3> : null}
      <p className="v2-gate-card__state" role="status">
        {unavailable
          ? "条件を確認できませんでした。しばらくしてからもう一度お試しください。"
          : headline ?? "このコンテンツは、条件を満たす人だけが見られます。"}
      </p>
      {description ? <p className="v2-gate-card__description">{description}</p> : null}
      {externalVideo ? <p className="v2-note">{VIDEO_REFERENCE_NOTE}</p> : null}

      {!opened.current ? (
        <ol className="v2-gate-steps" aria-label="開くまでの手順">
          <li className="v2-gate-steps__item" data-done={hasWallet === true ? "true" : "false"}>
            ウォレットをつなぐ{hasWallet === true ? "（連携済み）" : hasWallet === false ? "（ウォレット: 未連携）" : ""}
          </li>
          <li className="v2-gate-steps__item" data-done="false">
            トークンを手に入れる{purchase ? "（下の購入、または作成者の入手先）" : acquisition ? "（作成者の入手先）" : "（作成者はまだ入手先を示していません）"}
          </li>
          <li className="v2-gate-steps__item" data-done="false">
            開く（戻ると自動で確かめます）
          </li>
        </ol>
      ) : null}

      <div className="v2-gate__actions">
        {walletFirst ? <a className="v2-gate__button v2-gate__button--primary" href={WALLET_LINK_HREF} onClick={arm}>ウォレットを連携する</a> : null}
        {targetType && targetId ? (
          <button type="button" className={walletFirst ? "v2-gate__button" : "v2-gate__button v2-gate__button--primary"} onClick={() => void check()} disabled={recheck === "checking"}>
            {recheck === "checking" ? "確かめています…" : "もう一度確かめる"}
          </button>
        ) : null}
      </div>
      {retrying ? <p className="v2-note" role="status">確認中…</p> : null}
      {recheck === "denied" ? <p className="v2-note" role="status">まだ条件を満たしていません。</p> : null}
      {recheck === "unavailable" ? <p className="v2-note" role="status">確認できませんでした。しばらくしてからお試しください。</p> : null}
      {recheck === "limited" ? <p className="v2-note" role="status">確認の回数が上限に達しました。時間をおいてお試しください。</p> : null}
      {recheck === "missing" ? <p className="v2-note" role="status">再確認はまだ使えません。ページを読み込み直してください。</p> : null}

      {acquisition ? (
        <p className="v2-gate-card__acquire">
          <a href={acquisition} target="_blank" rel="noopener noreferrer nofollow ugc" onClick={arm}>{headline ? EXTERNAL_ACQUISITION_LABEL : "作成者が指定した外部のページ（ハブの外へ移動します）"}</a>
        </p>
      ) : null}
      {purchase ? <GohoTokenPurchasePanel content={purchase} tokenName={tokenName} recheckAccess={recheckAfterPurchase} /> : null}

      <details className="v2-gate-card__details">
        <summary>条件の詳しい内容</summary>
        {gate.conditions.length > 1 ? <p className="v2-gate-card__match">{matchLabel(gate.match)}</p> : null}
        <ul className="v2-gate-card__conditions">
          {gate.conditions.map((condition) => <li key={condition.ordinal}>{summarizeCondition(condition)}</li>)}
        </ul>
        <p className="v2-note">{STALE_ACCESS_NOTE}</p>
      </details>
    </article>
  );
}
