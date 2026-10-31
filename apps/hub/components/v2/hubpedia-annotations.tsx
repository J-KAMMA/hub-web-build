"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { HubpediaClaimProposalForm } from "@/components/v2/hubpedia-claim-proposal-form";
import { apiErrorMessage, authorKindLabel, hubItemHref, hubItemKindLabel, knowledgeStatusLabel } from "@/lib/hubpedia-wiki-ui";

export type AnnotationParagraph = { id: string; index: number; text: string; discussionCount: number };
export type AnnotationEvidence = { kind: string; itemId: string; stance: string; quote: string; status: string };
export type AnnotationClaim = {
  id: string;
  statement: string;
  status: string;
  knowledgeStatus: string | null;
  discussionCount: number;
  hubEvidence: AnnotationEvidence[];
};

type Comment = { id: string; parentId: string | null; body: string; createdAt: string; authorHandle: string };
type AnchorType = "claim" | "paragraph";

const anchorUrl = (slug: string, type: AnchorType, id: string, tail: "discussion" | "explain") =>
  `/api/hubpedia/articles/${encodeURIComponent(slug)}/anchors/${type}/${encodeURIComponent(id)}/${tail}`;

function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function claimsForParagraph(paragraph: AnnotationParagraph, claims: AnnotationClaim[]) {
  const text = normalize(paragraph.text);
  return claims.filter((claim) => {
    const statement = normalize(claim.statement);
    return statement.length > 0 && text.includes(statement);
  });
}

/* ---- 議論の欄 ---- */
export function HubpediaDiscussionThread({ slug, type, id, signedIn, label }: { slug: string; type: AnchorType; id: string; signedIn: boolean; label: string }) {
  const uid = useId();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(anchorUrl(slug, type, id, "discussion"));
      if (!response.ok) throw new Error("load");
      const data = (await response.json()) as { comments?: Comment[] };
      setComments(data.comments ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [slug, type, id]);

  useEffect(() => {
    setComments(null);
    void load();
  }, [load]);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) {
      setMessage("コメントを書いてください。");
      return;
    }
    if (body.length > 4000) {
      setMessage("コメントは4000文字までです。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(anchorUrl(slug, type, id, "discussion"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) setMessage(apiErrorMessage(data.code, data.error));
      else {
        setText("");
        await load();
      }
    } catch {
      setMessage("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hubpedia-wiki__thread" aria-label={`${label}の議論`}>
      {failed ? (
        <p className="v2-error" role="alert">議論を取得できませんでした。 <button type="button" className="v2-button" onClick={() => void load()}>再読み込み</button></p>
      ) : comments === null ? (
        <p className="v2-note" role="status">読み込み中</p>
      ) : comments.length ? (
        <ul className="hubpedia-wiki__comments">
          {comments.map((comment) => (
            <li key={comment.id}>
              <p className="hubpedia-wiki__comment-meta">{comment.authorHandle ? `@${comment.authorHandle}` : "不明"} ・ {comment.createdAt.slice(0, 10)}</p>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="v2-note">まだ議論はありません。</p>
      )}
      {signedIn ? (
        <form onSubmit={post} className="hubpedia-wiki__form" noValidate>
          <label htmlFor={`${uid}-comment`}>{label}について書く</label>
          <textarea id={`${uid}-comment`} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          {message ? <p role="alert" className="v2-error">{message}</p> : null}
          <button type="submit" className="v2-button" disabled={busy}>{busy ? "送信中" : "書き込む"}</button>
        </form>
      ) : (
        <p className="v2-note"><a href="/v2/auth?next=/v2/hubpedia">ログイン</a>すると書き込めます。</p>
      )}
    </section>
  );
}

/* ---- 右の列 ---- */
function ClaimCard({ slug, claim, signedIn, humanEditingEnabled, baseRevisionKey }: {
  slug: string;
  claim: AnnotationClaim;
  signedIn: boolean;
  humanEditingEnabled: boolean;
  baseRevisionKey: string;
}) {
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  return (
    <li className="hubpedia-wiki__claim">
      <p className="hubpedia-wiki__claim-statement">{claim.statement}</p>
      <p>
        <span className="hubpedia-wiki__badge" data-status={claim.knowledgeStatus ?? "none"}>{knowledgeStatusLabel(claim.knowledgeStatus)}</span>
      </p>
      {claim.hubEvidence.length ? (
        <ul className="hubpedia-wiki__evidence" aria-label="Hubの中の証拠">
          {claim.hubEvidence.map((item, index) => {
            const href = hubItemHref(item.kind, item.itemId);
            return (
              <li key={`${item.kind}-${item.itemId}-${index}`}>
                <span className="hubpedia-wiki__stance">{item.stance === "refutes" ? "反対" : "支持"}</span>{" "}
                {href ? <a href={href}>{hubItemKindLabel(item.kind)}を元で見る</a> : hubItemKindLabel(item.kind)}
                {item.quote ? <q className="hubpedia-wiki__quote">{item.quote}</q> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="v2-note">この主張に結び付いたHubの項目はありません。</p>
      )}
      <div className="hubpedia-wiki__actions">
        <button type="button" className="v2-button" aria-expanded={showDiscussion} onClick={() => setShowDiscussion((value) => !value)}>
          この主張の議論 {claim.discussionCount}
        </button>
        <button type="button" className="v2-button" aria-expanded={showEdit} onClick={() => setShowEdit((value) => !value)}>
          この主張の編集を提案
        </button>
      </div>
      {showDiscussion ? <HubpediaDiscussionThread slug={slug} type="claim" id={claim.id} signedIn={signedIn} label="この主張" /> : null}
      {showEdit ? (
        <HubpediaClaimProposalForm
          slug={slug}
          claimId={claim.id}
          statement={claim.statement}
          baseRevisionKey={baseRevisionKey}
          humanEditingEnabled={humanEditingEnabled}
          signedIn={signedIn}
        />
      ) : null}
    </li>
  );
}

export function HubpediaAnchorPanel({
  slug,
  paragraph,
  claims,
  authorKind,
  signedIn,
  humanEditingEnabled,
  baseRevisionKey,
  explainOnOpen,
  onClose,
}: {
  slug: string;
  paragraph: AnnotationParagraph;
  claims: AnnotationClaim[];
  authorKind: string;
  signedIn: boolean;
  humanEditingEnabled: boolean;
  baseRevisionKey: string;
  explainOnOpen: boolean;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [explain, setExplain] = useState<{ state: "idle" | "busy" | "queued" | "ready" | "error"; text?: string }>({ state: "idle" });

  useEffect(() => {
    headingRef.current?.focus();
  }, [paragraph.id]);

  const requestExplain = useCallback(async () => {
    if (!signedIn) {
      setExplain({ state: "error", text: "説明を頼むにはログインが必要です。" });
      return;
    }
    setExplain({ state: "busy" });
    try {
      const response = await fetch(anchorUrl(slug, "paragraph", paragraph.id, "explain"), { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { status?: string; note?: string; explanation?: string; error?: string; code?: string };
      if (!response.ok) setExplain({ state: "error", text: apiErrorMessage(data.code, data.error) });
      else if (data.status === "ready") setExplain({ state: "ready", text: data.explanation });
      else setExplain({ state: "queued", text: "依頼を受け付けました。準備ができたらここに出ます。" });
    } catch {
      setExplain({ state: "error", text: "通信できませんでした。もう一度お試しください。" });
    }
  }, [signedIn, slug, paragraph.id]);

  const autoRequested = useRef<string | null>(null);
  useEffect(() => {
    if (explainOnOpen && autoRequested.current !== paragraph.id) {
      autoRequested.current = paragraph.id;
      void requestExplain();
    }
  }, [explainOnOpen, paragraph.id, requestExplain]);

  return (
    <aside
      className="hubpedia-wiki__panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="hubpedia-wiki__panel-head">
        <h3 id={titleId} ref={headingRef} tabIndex={-1}>段落 {paragraph.index + 1} の根拠と議論</h3>
        <button type="button" className="v2-button" onClick={onClose}>閉じる</button>
      </header>
      <p className="hubpedia-wiki__author">{authorKindLabel(authorKind)}</p>
      <blockquote className="hubpedia-wiki__excerpt">{paragraph.text.length > 240 ? `${paragraph.text.slice(0, 240)}…` : paragraph.text}</blockquote>

      <div className="hubpedia-wiki__actions">
        <button type="button" className="v2-button" onClick={() => void requestExplain()} disabled={explain.state === "busy"}>
          {explain.state === "busy" ? "依頼中" : "説明して"}
        </button>
      </div>
      {explain.state !== "idle" && explain.state !== "busy" ? (
        <p role={explain.state === "error" ? "alert" : "status"} className={explain.state === "error" ? "v2-error" : "v2-note"}>{explain.text}</p>
      ) : null}

      <h4>この段落の主張と証拠</h4>
      {claims.length ? (
        <ul className="hubpedia-wiki__claims">
          {claims.map((claim) => (
            <ClaimCard key={claim.id} slug={slug} claim={claim} signedIn={signedIn} humanEditingEnabled={humanEditingEnabled} baseRevisionKey={baseRevisionKey} />
          ))}
        </ul>
      ) : (
        <p className="v2-note">この段落に結び付いた主張はまだ記録されていません。</p>
      )}

      <h4>この段落の議論</h4>
      <HubpediaDiscussionThread slug={slug} type="paragraph" id={paragraph.id} signedIn={signedIn} label="この段落" />
    </aside>
  );
}

/* ---- 段落の並び ---- */
export function HubpediaAnnotatedBody({
  slug,
  paragraphs,
  claims,
  authorKind,
  signedIn,
  humanEditingEnabled,
  baseRevisionKey,
}: {
  slug: string;
  paragraphs: AnnotationParagraph[];
  claims: AnnotationClaim[];
  authorKind: string;
  signedIn: boolean;
  humanEditingEnabled: boolean;
  baseRevisionKey: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [explainOnOpen, setExplainOnOpen] = useState(false);
  const triggers = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastTrigger = useRef<string | null>(null);

  const open = (id: string, explain: boolean) => {
    lastTrigger.current = id;
    setExplainOnOpen(explain);
    setOpenId(id);
  };
  const close = () => {
    setOpenId(null);
    setExplainOnOpen(false);
    const id = lastTrigger.current;
    if (id) requestAnimationFrame(() => triggers.current.get(id)?.focus());
  };

  const selected = paragraphs.find((paragraph) => paragraph.id === openId) ?? null;
  const claimCountTotal = claims.length;

  if (!paragraphs.length) return null;
  return (
    <section className="hubpedia-wiki" aria-label="段落ごとの根拠と議論">
      <p className="v2-note">段落ごとに、根拠・議論・編集の提案を開けます。主張 {claimCountTotal} 件。</p>
      <div className="hubpedia-wiki__layout" data-open={selected ? "true" : "false"}>
        <ol className="hubpedia-wiki__paragraphs">
          {paragraphs.map((paragraph) => (
            <li key={paragraph.id} className="hubpedia-wiki__paragraph" data-active={paragraph.id === openId ? "true" : undefined}>
              <p id={paragraph.id} className="hubpedia-wiki__text">{paragraph.text}</p>
              <div className="hubpedia-wiki__marker">
                <span className="hubpedia-wiki__author-tag">{authorKindLabel(authorKind)}</span>
                <button
                  type="button"
                  className="v2-button"
                  ref={(node) => {
                    if (node) triggers.current.set(paragraph.id, node);
                    else triggers.current.delete(paragraph.id);
                  }}
                  aria-label={`段落${paragraph.index + 1}の議論 ${paragraph.discussionCount}件を開く`}
                  aria-expanded={paragraph.id === openId}
                  onClick={() => open(paragraph.id, false)}
                >
                  議論 {paragraph.discussionCount}
                </button>
                <button type="button" className="v2-button" aria-label={`段落${paragraph.index + 1}を説明して`} onClick={() => open(paragraph.id, true)}>
                  説明して
                </button>
              </div>
            </li>
          ))}
        </ol>
        {selected ? (
          <HubpediaAnchorPanel
            slug={slug}
            paragraph={selected}
            claims={claimsForParagraph(selected, claims)}
            authorKind={authorKind}
            signedIn={signedIn}
            humanEditingEnabled={humanEditingEnabled}
            baseRevisionKey={baseRevisionKey}
            explainOnOpen={explainOnOpen}
            onClose={close}
          />
        ) : null}
      </div>
    </section>
  );
}
