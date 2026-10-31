"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/v2/ui/button";
import {
  WORK_ACCEPT_DAYS,
  WORK_DISPUTE_DAYS,
  WORK_FEE_NOTE_JA,
  WORK_MAX_PRICE_UNITS,
  WORK_MIN_PRICE_UNITS,
  WORK_REVIEW_DAYS,
  WORK_STATE_LABEL_EN,
  WORK_STATE_LABEL_JA,
  type WorkEscrowState,
  type WorkTicketPurpose,
} from "@/lib/work-commissions";
import "@/app/v2/v2-commissions.css";

/*
 * 指名依頼の画面部品 (DESIGN 9)。Hub は依頼文・スレッド・納品の一覧・公開の選択を持つ。
 * 支払・受諾・断り・納品の記録・受け取り・申し立ては Commerce の画面で行う。ここでは Hub の札を持って
 * Commerce へ移るだけで、決済の中身は Hub を通らない。
 */

const t = (japanese: boolean, ja: string, en: string) => (japanese ? ja : en);

async function post(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: {} };
  }
}

const errorText = (data: Record<string, unknown>, fallback: string) => (typeof data.error === "string" ? data.error : fallback);

export function WorkStateBadge({ state, japanese }: { state: WorkEscrowState; japanese: boolean }) {
  return (
    <span className={`v2-work__state v2-work__state--${state}`}>
      {japanese ? WORK_STATE_LABEL_JA[state] : WORK_STATE_LABEL_EN[state]}
    </span>
  );
}

/* ------------------------------------------------------------ settings */

export type OfferForm = {
  accepting: boolean;
  minPriceUnits: number;
  priceNote: string;
  acceptsText: string;
  refusesText: string;
  turnaroundDays: number;
  categories: string[];
  adultAllowed: boolean;
  maxOpen: number;
};

export function V2CommissionSettings({ offer, adultOptIn, japanese }: { offer: OfferForm; adultOptIn: boolean; japanese: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    ...offer,
    minPriceUnits: String(offer.minPriceUnits),
    turnaroundDays: String(offer.turnaroundDays),
    maxOpen: String(offer.maxOpen),
    categories: offer.categories.join("、"),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => { setForm((current) => ({ ...current, [key]: value })); setSaved(false); };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const result = await post("/api/commissions/settings", { ...form }, "PUT");
    setBusy(false);
    if (!result.ok) { setMessage(errorText(result.data, t(japanese, "保存できませんでした。", "Could not save."))); return; }
    setSaved(true);
    router.refresh();
  };

  return (
    <form className="v2-work v2-work__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="v2-work__check">
        <input type="checkbox" checked={form.accepting} onChange={(event) => set("accepting", event.target.checked)} />
        <span>{t(japanese, "依頼を受け付ける（止めるときはチェックを外します。すぐに閉じます）", "Accept requests (uncheck to pause immediately)")}</span>
      </label>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-min">{t(japanese, `最低額（JPYC、${WORK_MIN_PRICE_UNITS}〜${WORK_MAX_PRICE_UNITS}）`, `Minimum (JPYC, ${WORK_MIN_PRICE_UNITS}-${WORK_MAX_PRICE_UNITS})`)}</label>
        <input id="wk-min" className="v2-work__input" inputMode="numeric" value={form.minPriceUnits} onChange={(event) => set("minPriceUnits", event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-note">{t(japanese, "価格の目安の説明", "Price guide")}</label>
        <textarea id="wk-note" className="v2-work__textarea" maxLength={500} value={form.priceNote} onChange={(event) => set("priceNote", event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-accepts">{t(japanese, "受ける内容", "What I accept")}</label>
        <textarea id="wk-accepts" className="v2-work__textarea" maxLength={1000} value={form.acceptsText} onChange={(event) => set("acceptsText", event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-refuses">{t(japanese, "受けない内容", "What I do not accept")}</label>
        <textarea id="wk-refuses" className="v2-work__textarea" maxLength={1000} value={form.refusesText} onChange={(event) => set("refusesText", event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-cats">{t(japanese, "種類（読点か改行で区切る。自由に決められます）", "Kinds (comma separated)")}</label>
        <input id="wk-cats" className="v2-work__input" value={form.categories} onChange={(event) => set("categories", event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-days">{t(japanese, "所要日数（1〜90）", "Turnaround days (1-90)")}</label>
        <input id="wk-days" className="v2-work__input" inputMode="numeric" value={form.turnaroundDays} onChange={(event) => set("turnaroundDays", event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wk-open">{t(japanese, "同時に受ける数（1〜20。達すると自動で閉じます）", "Open at once (1-20)")}</label>
        <input id="wk-open" className="v2-work__input" inputMode="numeric" value={form.maxOpen} onChange={(event) => set("maxOpen", event.target.value)} />
      </div>
      <label className="v2-work__check">
        <input type="checkbox" checked={form.adultAllowed} disabled={!adultOptIn && !form.adultAllowed} onChange={(event) => set("adultAllowed", event.target.checked)} />
        <span>{t(japanese, "成人向けの依頼を受ける", "Accept adult requests")}</span>
      </label>
      {!adultOptIn ? (
        <p className="v2-work__note">{t(japanese, "成人向けを受けるには、先に設定で成人向け表示を有効にしてください。依頼者も成人の確認が要ります。動画の納品はできません。", "Enable adult content in settings first. Clients need adult verification too. Video delivery is not allowed.")}</p>
      ) : null}
      <p className="v2-work__note">{t(japanese, `時給・勤務時間などの雇用に近い内容は受け付けられません。${WORK_FEE_NOTE_JA}。`, "Employment-style work is not supported. The fee is 1% of the reward (tax included).")}</p>
      {message ? <p className="v2-work__error" role="alert">{message}</p> : null}
      <div className="v2-work__actions">
        <Button variant="primary" type="submit" label={t(japanese, "保存する", "Save")} busy={busy} />
        {saved ? <span className="v2-work__note" role="status">{t(japanese, "保存しました。", "Saved.")}</span> : null}
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- request */

export function V2CommissionRequestForm({
  workerHandle,
  workerName,
  offer,
  canAdult,
  japanese,
}: {
  workerHandle: string;
  workerName: string;
  offer: OfferForm;
  /** The client holds adult verification (the server checks again). */
  canAdult: boolean;
  japanese: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(offer.categories[0] ?? "");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState(String(offer.minPriceUnits));
  const [adult, setAdult] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const result = await post("/api/commissions/requests", {
      workerHandle, category, title, brief, budgetUnits: budget, audience: adult ? "adult" : "general", acknowledged: ack,
    });
    setBusy(false);
    if (!result.ok) { setMessage(errorText(result.data, t(japanese, "依頼を作れませんでした。", "Could not create the request."))); return; }
    router.push(`/v2/commissions/${String(result.data.contractId)}`);
  };

  return (
    <form className="v2-work v2-work__form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <p className="v2-work__note">{t(japanese, `${workerName}（@${workerHandle}）への依頼です。`, `Request to ${workerName} (@${workerHandle}).`)}</p>
      {offer.priceNote ? <p className="v2-work__body">{offer.priceNote}</p> : null}
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wr-cat">{t(japanese, "種類", "Kind")}</label>
        {offer.categories.length ? (
          <select id="wr-cat" className="v2-work__select" value={category} onChange={(event) => setCategory(event.target.value)}>
            {offer.categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        ) : (
          <input id="wr-cat" className="v2-work__input" maxLength={30} value={category} onChange={(event) => setCategory(event.target.value)} />
        )}
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wr-title">{t(japanese, "題名", "Title")}</label>
        <input id="wr-title" className="v2-work__input" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wr-brief">{t(japanese, "依頼文（修正のやり取りはありません。ここに書いたことが全てです）", "Brief (there are no revisions; this is everything)")}</label>
        <textarea id="wr-brief" className="v2-work__textarea" maxLength={4000} value={brief} onChange={(event) => setBrief(event.target.value)} />
      </div>
      <div className="v2-work__field">
        <label className="v2-work__label" htmlFor="wr-budget">{t(japanese, `額（JPYC。${offer.minPriceUnits}以上）`, `Amount (JPYC, at least ${offer.minPriceUnits})`)}</label>
        <input id="wr-budget" className="v2-work__input" inputMode="numeric" value={budget} onChange={(event) => setBudget(event.target.value)} />
      </div>
      {offer.adultAllowed ? (
        <label className="v2-work__check">
          <input type="checkbox" checked={adult} disabled={!canAdult} onChange={(event) => setAdult(event.target.checked)} />
          <span>{t(japanese, canAdult ? "成人向けの依頼" : "成人向けの依頼（成人の確認が必要です）", "Adult request")}</span>
        </label>
      ) : null}
      <ul className="v2-work__terms" aria-label={t(japanese, "送る前の確認", "Before you send")}>
        <li>{t(japanese, "修正のやり取りはありません。追加は新しい依頼にします。", "No revisions. Extra work is a new request.")}</li>
        <li>{t(japanese, `期限：作り手は${WORK_ACCEPT_DAYS}日以内に受けるか断ります。受けると、${offer.turnaroundDays}日以内に納品されます。`, `Deadlines: ${WORK_ACCEPT_DAYS} days to accept, then ${offer.turnaroundDays} days to deliver.`)}</li>
        <li>{t(japanese, `返金：断り・期限切れで全額が戻ります。納品後は${WORK_REVIEW_DAYS}日の確認期間があり、未着なら1回だけ申し立てられ、${WORK_DISPUTE_DAYS}日で合意がなければ全額が戻ります。`, "Refunds: full refund on decline or expiry; one non-delivery claim during review, refunded if unresolved after 14 days.")}</li>
        <li>{t(japanese, `${WORK_FEE_NOTE_JA}。支払は Commerce の画面で行い、資金は運営が動かせない預かり口座に入ります。`, "1% fee. Payment happens on Commerce; funds sit in an escrow nobody at jkamma can move.")}</li>
        <li>{t(japanese, "公開するかどうかは、完了したあとにあなたが選べます（既定は非公開）。", "You choose whether to make it public after completion (private by default).")}</li>
        <li>{t(japanese, "エスクロー外での支払は、Hub も Commerce も扱いません。", "Payments outside the escrow are not handled by Hub or Commerce.")}</li>
      </ul>
      <label className="v2-work__check">
        <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
        <span>{t(japanese, "上の条件を確かめました。", "I have read the terms above.")}</span>
      </label>
      {message ? <p className="v2-work__error" role="alert">{message}</p> : null}
      <div className="v2-work__actions">
        <Button variant="primary" type="submit" label={t(japanese, "依頼を作る（次に支払へ進みます）", "Create request (payment is next)")} busy={busy} disabled={!ack || !title.trim() || !brief.trim()} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- contract */

export type ContractFile = { id: string; name: string; size: number; sha256: string };

export type ContractViewData = {
  contractId: string;
  side: "client" | "worker";
  state: WorkEscrowState;
  checking: boolean;
  title: string;
  category: string;
  brief: string;
  audience: "general" | "adult";
  priceUnits: number;
  turnaroundDays: number;
  acceptBy: string | null;
  deliverBy: string | null;
  releaseAt: string | null;
  flagUntil: string | null;
  otherHandle: string;
  otherName: string;
  publication: "private" | "public";
  workerListed: boolean;
  delivery: { files: ContractFile[]; hash: string; deliveredAt: string } | null;
  clientStats: { completed: number; refundedAfterFlag: number } | null;
  messages: Array<{ id: string; mine: boolean; body: string; flagged: boolean; createdAt: string }>;
  threadWritable: boolean;
  actions: WorkTicketPurpose[];
  deliveryMismatch: boolean;
  canDownload: boolean;
  createdAt: string;
};

const ACTION_LABEL: Record<WorkTicketPurpose, [string, string]> = {
  bind: ["受取先を結ぶ（Commerce）", "Link receiving address (Commerce)"],
  fund: ["支払へ進む（Commerce）", "Go to payment (Commerce)"],
  accept: ["受ける（Commerce）", "Accept (Commerce)"],
  decline: ["断る（Commerce）", "Decline (Commerce)"],
  deliver: ["納品を記録する（Commerce）", "Record delivery (Commerce)"],
  confirm: ["受け取った（Commerce）", "Confirm receipt (Commerce)"],
  flag: ["未着を申し立てる（Commerce）", "Report non-delivery (Commerce)"],
};

const time = (iso: string | null, japanese: boolean) =>
  iso ? new Date(iso).toLocaleString(japanese ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function V2CommissionContract({ view, japanese }: { view: ContractViewData; japanese: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [body, setBody] = useState("");
  const [warn, setWarn] = useState(false);
  const worker = view.side === "worker";

  const handoff = async (purpose: WorkTicketPurpose) => {
    if (busy) return;
    setBusy(purpose);
    setMessage("");
    const result = await post(`/api/commissions/${view.contractId}/ticket`, { purpose });
    if (!result.ok || typeof result.data.url !== "string") {
      setBusy("");
      setMessage(errorText(result.data, t(japanese, "Commerce へ進めませんでした。", "Could not open Commerce.")));
      return;
    }
    // The ticket rides in the URL fragment; the browser leaves Hub and Commerce takes over.
    window.location.assign(result.data.url);
  };

  const sendMessage = async () => {
    if (busy || !body.trim()) return;
    setBusy("message");
    setMessage("");
    const result = await post(`/api/commissions/${view.contractId}/messages`, { body });
    setBusy("");
    if (!result.ok) { setMessage(errorText(result.data, t(japanese, "送れませんでした。", "Could not send."))); return; }
    setWarn(result.data.flagged === true);
    setBody("");
    router.refresh();
  };

  const deliver = async (files: FileList | null) => {
    if (busy || !files?.length) return;
    setBusy("deliver");
    setMessage("");
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) {
        const issued = await post("/api/content-files", { fileName: file.name, sizeBytes: file.size });
        const upload = issued.data.upload as { fileId: string; ticket: string; header: string; path: string } | undefined;
        if (!issued.ok || !upload || !upload.path.startsWith("/vault/api/files/")) {
          setMessage(errorText(issued.data, t(japanese, "アップロードを始められませんでした。", "Could not start the upload.")));
          return;
        }
        const form = new FormData();
        form.append("file", file);
        const stored = await fetch(upload.path, { method: "POST", headers: { [upload.header]: upload.ticket }, body: form });
        if (stored.status !== 201) {
          setMessage(t(japanese, "ファイルを受け付けられませんでした。形式か大きさを確かめてください。", "The file was not accepted."));
          return;
        }
        ids.push(upload.fileId);
      }
      const sealed = await post(`/api/commissions/${view.contractId}/delivery`, { fileIds: ids });
      if (!sealed.ok) { setMessage(errorText(sealed.data, t(japanese, "納品を確定できませんでした。", "Could not seal the delivery."))); return; }
      router.refresh();
    } finally {
      setBusy("");
    }
  };

  const download = async (fileId: string) => {
    const result = await post(`/api/commissions/${view.contractId}/download`, { fileId });
    if (!result.ok || typeof result.data.url !== "string" || !result.data.url.startsWith("/vault/api/files/")) {
      setMessage(errorText(result.data, t(japanese, "受け取れませんでした。", "Could not download.")));
      return;
    }
    window.location.assign(result.data.url);
  };

  const publish = async (payload: Record<string, unknown>) => {
    const result = await post(`/api/commissions/${view.contractId}/publication`, payload);
    if (!result.ok) { setMessage(errorText(result.data, t(japanese, "変更できませんでした。", "Could not update."))); return; }
    router.refresh();
  };

  if (worker && view.state === "pending_funding") {
    return (
      <div className="v2-work">
        <p className="v2-work__body">{t(japanese, "新しい依頼があります。入金が確かめられるまで、内容は表示されません。依頼を受けられる状態にするため、先に受取先のアドレスを Commerce で結んでください。", "A new request exists. Its content stays hidden until the payment is confirmed. Link your receiving address on Commerce first.")}</p>
        <div className="v2-work__actions">
          {view.actions.map((purpose) => <Button key={purpose} variant="primary" label={ACTION_LABEL[purpose][japanese ? 0 : 1]} busy={busy === purpose} onClick={() => void handoff(purpose)} />)}
        </div>
        {message ? <p className="v2-work__error" role="alert">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="v2-work">
      <section className="v2-work__section" aria-label={t(japanese, "依頼", "Request")}>
        <h2 className="v2-work__heading">{view.title}</h2>
        {view.deliveryMismatch ? (
          <span className="v2-work__state v2-work__state--flagged">{t(japanese, "納品の不一致", "Delivery mismatch")}</span>
        ) : (
          <WorkStateBadge state={view.state} japanese={japanese} />
        )}
        {view.deliveryMismatch ? (
          <p className="v2-work__warn" role="alert">
            {worker
              ? t(japanese, `記録された納品の指紋が、Hub の納品物と一致しません。依頼者は ${time(view.releaseAt, japanese)} までに未着の申し立てができ、期限が過ぎると支払は作り手に渡ります。納品を確かめてください。`, "The recorded fingerprint does not match a Hub delivery. The client can report non-delivery until the review deadline.")
              : t(japanese, `記録された納品の指紋が、Hub に届いた納品物と一致しません。中身が届いていないおそれがあります。${time(view.releaseAt, japanese)} までに「未着を申し立てる」を押してください。期限が過ぎると支払は作り手に渡ります。`, "The recorded fingerprint does not match any delivery on Hub. Report non-delivery before the review deadline, or the payment is released.")}
          </p>
        ) : null}
        {view.checking ? <p className="v2-work__note" role="status">{t(japanese, "状態を確認中です。確認できるまで、操作は出しません。", "Checking the state. No action is offered until it is confirmed.")}</p> : null}
        <dl className="v2-work__facts">
          <dt>{worker ? t(japanese, "依頼者", "Client") : t(japanese, "作り手", "Creator")}</dt>
          <dd><Link href={`/v2/profile/${encodeURIComponent(view.otherHandle)}`}>{view.otherName}</Link></dd>
          <dt>{t(japanese, "種類", "Kind")}</dt><dd>{view.category}{view.audience === "adult" ? t(japanese, "（成人向け）", " (adult)") : ""}</dd>
          <dt>{t(japanese, "額", "Amount")}</dt><dd>{view.priceUnits.toLocaleString()} JPYC</dd>
          <dt>{t(japanese, "受諾の期限", "Accept by")}</dt><dd>{time(view.acceptBy, japanese)}</dd>
          <dt>{t(japanese, "納品の期限", "Deliver by")}</dt><dd>{time(view.deliverBy, japanese)}</dd>
          <dt>{t(japanese, "解放の時刻", "Release at")}</dt><dd>{time(view.releaseAt, japanese)}</dd>
          {view.flagUntil ? <><dt>{t(japanese, "申し立ての期限", "Claim until")}</dt><dd>{time(view.flagUntil, japanese)}</dd></> : null}
        </dl>
        {worker && view.clientStats ? (
          <p className="v2-work__note">{t(japanese, `この依頼者の実績：完了 ${view.clientStats.completed} 件、未着の申し立てによる返金 ${view.clientStats.refundedAfterFlag} 件。`, `Client history: ${view.clientStats.completed} completed, ${view.clientStats.refundedAfterFlag} refunded after a claim.`)}</p>
        ) : null}
        <p className="v2-work__body">{view.brief}</p>
      </section>

      {view.actions.length ? (
        <section className="v2-work__section" aria-label={t(japanese, "次の操作", "Next step")}>
          <div className="v2-work__actions">
            {view.actions.filter((purpose) => purpose !== "deliver" || view.delivery).map((purpose) => (
              <Button key={purpose} variant={purpose === "fund" || purpose === "accept" || purpose === "confirm" ? "primary" : "secondary"} label={ACTION_LABEL[purpose][japanese ? 0 : 1]} busy={busy === purpose} onClick={() => void handoff(purpose)} />
            ))}
          </div>
          <p className="v2-work__note">{t(japanese, "署名と支払は Commerce の画面で行います。Hub は決済の内容を受け取りません。", "Signing and payment happen on Commerce. Hub never receives payment details.")}</p>
        </section>
      ) : null}

      {worker && view.state === "accepted" ? (
        <section className="v2-work__section" aria-label={t(japanese, "納品", "Delivery")}>
          <h3 className="v2-work__heading">{t(japanese, "納品", "Delivery")}</h3>
          <p className="v2-work__note">{t(japanese, "ファイルは検査のあとに納品物として確定します。確認期間のあいだ、依頼者にはファイル名・大きさ・指紋だけが見えます。確定したあと、上の「納品を記録する」で指紋を Commerce に記します。", "Files are checked, then sealed. During review the client sees names, sizes and the fingerprint only. Record the fingerprint on Commerce afterwards.")}</p>
          <input type="file" multiple aria-label={t(japanese, "納品するファイル", "Files to deliver")} disabled={busy === "deliver"} onChange={(event) => void deliver(event.target.files)} />
        </section>
      ) : null}

      {view.delivery ? (
        <section className="v2-work__section" aria-label={t(japanese, "納品物", "Delivered files")}>
          <h3 className="v2-work__heading">{t(japanese, "納品物", "Delivered files")}</h3>
          <ul className="v2-work__files">
            {view.delivery.files.map((file) => (
              <li key={file.id} className="v2-work__file">
                <span className="v2-work__file-name">{file.name} ({size(file.size)})</span>
                {view.canDownload ? <Button variant="secondary" label={t(japanese, "受け取る", "Download")} onClick={() => void download(file.id)} /> : null}
              </li>
            ))}
          </ul>
          <p className="v2-work__hash">{t(japanese, "指紋 ", "Fingerprint ")}{view.delivery.hash}</p>
          {!view.canDownload && !worker ? <p className="v2-work__note">{t(japanese, "全体は、完了したあとに受け取れます。", "You can download the files after completion.")}</p> : null}
        </section>
      ) : null}

      {view.state === "released" ? (
        <section className="v2-work__section" aria-label={t(japanese, "公開", "Public display")}>
          <h3 className="v2-work__heading">{t(japanese, "公開の選択", "Public display")}</h3>
          {worker ? (
            <>
              <p className="v2-work__note">{view.publication === "public" ? t(japanese, "依頼者は公開を選びました。自分の作品一覧に載せるかは、あなたが選べます。", "The client chose public. Whether it appears in your works is up to you.") : t(japanese, "依頼者は非公開を選んでいます。", "The client kept it private.")}</p>
              {view.publication === "public" ? <Button variant="secondary" pressed={view.workerListed} label={view.workerListed ? t(japanese, "作品一覧に載せている（外す）", "Listed (remove)") : t(japanese, "作品一覧に載せる", "List in my works")} onClick={() => void publish({ listed: !view.workerListed })} /> : null}
            </>
          ) : view.audience === "adult" ? (
            <p className="v2-work__note">{t(japanese, "成人向けの依頼は公開できません。", "Adult commissions cannot be made public.")}</p>
          ) : (
            <Button variant="secondary" pressed={view.publication === "public"} label={view.publication === "public" ? t(japanese, "公開中（非公開にする）", "Public (make private)") : t(japanese, "非公開（公開する）", "Private (make public)")} onClick={() => void publish({ publication: view.publication === "public" ? "private" : "public" })} />
          )}
        </section>
      ) : null}

      <section className="v2-work__section" aria-label={t(japanese, "スレッド", "Thread")}>
        <h3 className="v2-work__heading">{t(japanese, "スレッド", "Thread")}</h3>
        <p className="v2-work__note">{t(japanese, "この契約の2人だけが読めます。添付はできません。口座など外での支払の誘導は通報の対象です。", "Only the two of you can read this. No attachments. Steering payment outside the escrow can be reported.")}</p>
        {view.messages.length ? (
          <ul className="v2-work__thread">
            {view.messages.map((message) => (
              <li key={message.id} className={`v2-work__msg${message.mine ? " v2-work__msg--mine" : ""}`}>
                <span className="v2-work__body">{message.body}</span>
                {message.flagged ? <span className="v2-work__warn">{t(japanese, "外での支払に誘導していないか確かめてください。", "Check that this does not steer payment outside the escrow.")}</span> : null}
                <time dateTime={message.createdAt}>{time(message.createdAt, japanese)}</time>
              </li>
            ))}
          </ul>
        ) : <p className="v2-work__note">{t(japanese, "まだ書き込みはありません。", "No messages yet.")}</p>}
        {view.threadWritable ? (
          <form className="v2-work__form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label className="ui-sr" htmlFor="wk-msg">{t(japanese, "メッセージ", "Message")}</label>
            <textarea id="wk-msg" className="v2-work__textarea" maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} />
            {warn ? <p className="v2-work__warn" role="status">{t(japanese, "外での支払は、Hub も Commerce も扱いません。エスクローの外で払うと、返金の道が使えません。", "Payments outside the escrow are not handled and have no refund path.")}</p> : null}
            <div className="v2-work__actions"><Button variant="secondary" type="submit" label={t(japanese, "送る", "Send")} busy={busy === "message"} disabled={!body.trim()} /></div>
          </form>
        ) : <p className="v2-work__note">{t(japanese, "このスレッドには、いま書き込めません。", "This thread is closed for new messages.")}</p>}
      </section>

      {message ? <p className="v2-work__error" role="alert">{message}</p> : null}
    </div>
  );
}
