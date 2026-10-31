"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "mute" | "block";
type Receipt = { viewerId: string; postId: string; control: { muted: boolean; blocked: boolean } };
type Intent = { kind: Kind; enabled: boolean; viewerId: string; postId: string };
class Rejected extends Error { constructor(public status: number) { super("rejected"); } }
class ActorChanged extends Error {}
const record = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function receipt(value: unknown, postId: string, viewerId?: string): Receipt {
  if (!record(value, ["viewerId", "postId", "control"]) || value.postId !== postId
    || typeof value.viewerId !== "string" || !value.viewerId.trim() || value.viewerId.length > 160 || /\p{Cc}|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.viewerId)
    || !record(value.control, ["muted", "blocked"]) || typeof value.control.muted !== "boolean" || typeof value.control.blocked !== "boolean") throw Error("invalid_receipt");
  if (viewerId && viewerId !== value.viewerId) throw new ActorChanged();
  return { viewerId: value.viewerId, postId, control: { muted: value.control.muted, blocked: value.control.blocked } };
}
async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Rejected(response.status);
  const reader = response.body?.getReader(); if (!reader) throw Error("invalid_receipt");
  const decoder = new TextDecoder("utf-8", { fatal: true }); let body = "", size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel().catch(() => {}); throw Error("invalid_receipt"); }
      body += decoder.decode(chunk.value, { stream: true }); }
    return JSON.parse(body + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** Author identities stay server-side; these are only the current viewer's preferences. */
export function ThreadAuthorControl({ postId, kinds = ["mute", "block"], locale = "ja", className, confirmEnable = false, disabled = false }: {
  postId: string; kinds?: readonly Kind[]; locale?: string; className?: string; confirmEnable?: boolean; disabled?: boolean;
}) {
  const router = useRouter(), ja = locale.startsWith("ja"), mounted = useRef(false), epoch = useRef({}), currentPost = useRef(postId);
  currentPost.current = postId;
  const controllers = useRef(new Set<AbortController>()), busy = useRef(false), known = useRef<Receipt | null>(null), intent = useRef<Intent | null>(null);
  const [pending, setPending] = useState(false), [control, setControl] = useState<Receipt | null>(null), [held, setHeld] = useState<Intent | null>(null), [message, setMessage] = useState("");
  const alive = (token: object) => mounted.current && epoch.current === token && currentPost.current === postId;
  useEffect(() => {
    mounted.current = true;
    const reset = () => { epoch.current = {}; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); busy.current = false;
      known.current = null; intent.current = null; setPending(false); setControl(null); setHeld(null); setMessage(ja ? "アカウントが変わりました。状態を確認してください。" : "Account changed. Check the state again."); };
    epoch.current = {}; known.current = null; intent.current = null; busy.current = false; setControl(null); setHeld(null); setMessage(""); setPending(false);
    window.addEventListener("hub-account-changed", reset);
    return () => { mounted.current = false; epoch.current = {}; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); window.removeEventListener("hub-account-changed", reset); };
  }, [postId, ja]);
  async function request(token: object, operation?: Intent) {
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch(`/api/bbs/thread-posts/${encodeURIComponent(postId)}/relationship`, {
        method: operation ? "PUT" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        ...(operation ? { headers: { "content-type": "application/json", "x-hub-expected-viewer": operation.viewerId }, body: JSON.stringify({ kind: operation.kind, enabled: operation.enabled }) } : {}),
      });
      const value = await readResponse(response);
      if (!alive(token)) return null;
      return receipt(value, postId, operation?.viewerId ?? known.current?.viewerId ?? intent.current?.viewerId);
    } finally { controllers.current.delete(controller); }
  }
  function apply(value: Receipt) { known.current = value; setControl(value); }
  function actorFailure() { epoch.current = {}; known.current = null; intent.current = null; setControl(null); setHeld(null); busy.current = false; setPending(false);
    setMessage(ja ? "アカウントが変わりました。状態を確認してください。" : "Account changed. Check the state again."); }
  async function verify(token: object) {
    const value = await request(token); if (!value || !alive(token)) return;
    apply(value);
    const operation = intent.current;
    if (operation && value.control[operation.kind === "mute" ? "muted" : "blocked"] === operation.enabled) {
      intent.current = null; setHeld(null); setMessage(ja ? "希望した表示設定を確認しました。" : "Confirmed the requested setting."); router.refresh();
    } else setMessage(operation ? (ja ? "希望した状態は確認できません。同じ希望で再試行できます。" : "Not confirmed. You can retry the same setting.") : "");
  }
  async function reload() {
    if (busy.current || disabled) return; const token = epoch.current; busy.current = true; setPending(true);
    try { await verify(token); }
    catch (error) { if (alive(token)) { if (error instanceof ActorChanged) actorFailure(); else { known.current = null; setControl(null); setMessage(ja ? "状態を確認できません。変更せずに再確認してください。" : "Could not read the state. Check again before changing it."); } } }
    finally { if (alive(token)) { busy.current = false; setPending(false); } }
  }
  async function change(kind: Kind, retry = false) {
    if (busy.current || disabled || !known.current || (retry ? !intent.current : !!intent.current)) return;
    const operation = retry ? intent.current! : { kind, enabled: !known.current.control[kind === "mute" ? "muted" : "blocked"], viewerId: known.current.viewerId, postId };
    if (!retry && operation.enabled && confirmEnable && !window.confirm(ja ? `この投稿者を${kind === "mute" ? "ミュート" : "ブロック"}しますか。` : `${kind === "mute" ? "Mute" : "Block"} this author?`)) return;
    const token = epoch.current; intent.current = operation; setHeld(operation); busy.current = true; setPending(true); setMessage("");
    let accepted = false;
    try {
      const value = await request(token, operation); if (!value || !alive(token)) return;
      if (value.control[operation.kind === "mute" ? "muted" : "blocked"] !== operation.enabled) throw Error("unconfirmed");
      accepted = true; apply(value); await verify(token);
    } catch (error) {
      if (!alive(token)) return;
      if (error instanceof ActorChanged || error instanceof Rejected && error.status === 409) { actorFailure(); return; }
      if (!accepted && error instanceof Rejected && [400, 401, 403, 404].includes(error.status)) {
        known.current = null; setControl(null); setMessage(ja ? "設定を変更できません。状態を確認してください。" : "The change was rejected. Check the state.");
      } else if (accepted) {
        known.current = null; setControl(null); setMessage(ja ? "保存結果は未確認です。状態を確認してください。" : "Result unknown. Check the state.");
      } else {
        setMessage(ja ? "保存結果を確認しています…" : "Checking the result…");
        try { await verify(token); } catch (readError) { if (alive(token)) { if (readError instanceof ActorChanged) actorFailure(); else { known.current = null; setControl(null); setMessage(ja ? "保存結果は未確認です。状態を確認してください。" : "Result unknown. Check the state."); } } }
      }
    } finally { if (alive(token)) { busy.current = false; setPending(false); } }
  }
  const label = (kind: Kind) => kind === "mute" ? (ja ? "ミュート" : "Mute") : (ja ? "ブロック" : "Block");
  return <details aria-label={ja ? "投稿者の表示設定" : "Author display settings"} onToggle={event => {
    if (event.currentTarget instanceof HTMLDetailsElement && event.currentTarget.open && !known.current && !busy.current) void reload();
  }}>
    <summary className={className}>{ja ? "投稿者の表示設定" : "Author display settings"}</summary>
    <div aria-busy={pending}>
      {kinds.map(kind => <button type="button" className={className} key={kind} disabled={disabled || pending || !control || !!held} onClick={() => void change(kind)}>
        {control?.control[kind === "mute" ? "muted" : "blocked"] ? (ja ? `${label(kind)}解除` : `Un${label(kind).toLowerCase()}`) : label(kind)}
      </button>)}
      <button type="button" className={className} disabled={disabled || pending} onClick={() => void reload()}>{ja ? "状態を確認" : "Check state"}</button>
      {held ? <button type="button" className={className} disabled={disabled || pending || !control} onClick={() => void change(held.kind, true)}>{ja ? "同じ希望で再試行" : "Retry the same setting"}</button> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  </details>;
}
