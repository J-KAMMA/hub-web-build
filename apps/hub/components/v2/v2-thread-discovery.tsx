"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useThreadCandidates } from "@/lib/use-thread-candidates";
import { V2DiscoveryOptions, V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";

import { rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import type { ThreadSummary } from "@/lib/domain";
import { getThreadType, THREAD_TYPE_LABELS } from "@/lib/thread-type";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

export function V2ThreadDiscovery({
  threads,
  excerpts,
  locale,
  recommended,
  candidateQuery,
}: {
  threads: ThreadSummary[];
  excerpts: Record<string, string>;
  locale: string;
  recommended: boolean;
  candidateQuery?: string;
}) {
  const ja = locale === "ja";
  const feedback = useDiscoveryFeedback("threads");
  const { interests, enabled, record } = useHubRecommendations();
  const candidates = useThreadCandidates(threads, excerpts, recommended ? candidateQuery : undefined);
  const [visibleCount,setVisibleCount]=useState(20);
  const ordered = useMemo(() => {
    if (!recommended) return threads;
    const pool = [...candidates.threads].sort((a,b)=>b.postCount-a.postCount||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
    const pinned = pool.filter((thread) => thread.pinned);
    const unpinned = pool.filter((thread) => !thread.pinned);
    const ranked = recommended
      ? rankDiscoveryItems(unpinned, enabled ? interests : [], (thread) => ({
        text: `${thread.title} ${(thread.tags ?? []).join(" ")} ${thread.boardKey}`,
      }))
      : unpinned;
    return [...pinned, ...ranked];
  }, [threads, candidates.threads, recommended, enabled, interests]);
  const available=ordered.filter(thread=>!recommended||thread.pinned||!feedback.isHidden(thread.id));

  const recordThreadInterest = useCallback((thread: ThreadSummary) => {
    if (thread.tags?.length) record("community", thread.tags);
  }, [record]);

  return (
    <>
    {recommended ? <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} /> : null}
    {candidates.loading?<p className="v2-note" role="status">{ja?"スレッドを読み込んでいます…":"Loading threads…"}</p>:null}
    {candidates.error?<p className="v2-error" role="status">{ja?"スレッドの追加取得に失敗しました。":"Could not load additional threads."}<button type="button" className="v2-btn" onClick={candidates.continueLoading}>{ja?"再試行":"Retry"}</button></p>:null}
    {!candidates.loading&&!candidates.error&&candidates.hasMore?<button type="button" className="v2-btn" onClick={candidates.continueLoading}>{ja?"さらにスレッドを読み込む":"Load more candidates"}</button>:null}
    {!available.length&&!candidates.loading&&!candidates.error&&!candidates.hasMore?<p className="v2-note">{ja?"表示できるスレッドがありません。絞り込みや並び順を変更するか、設定で非表示をリセットできます。":"No threads to show. Change filters or sort, or reset hidden recommendations."}</p>:null}
    <ul className="v2-tlist">
      {(candidateQuery!==undefined&&recommended?available.slice(0,visibleCount):available).map((thread) => {
        const excerpt = candidates.excerpts[thread.id] ?? "";
        return (
          <li key={thread.id} className="v2-tcard">
            <p className="v2-tcard__meta">
              <span className="v2-badge">{THREAD_TYPE_LABELS[getThreadType(thread)]}</span>
              {thread.pinned ? <span className="v2-badge">{ja ? "固定" : "Pinned"}</span> : null}
              {thread.solvedAt ? <span className="v2-badge v2-badge--best">{ja ? "解決済み" : "Solved"}</span> : null}
              <span className="v2-post__time"><V2RelativeTime value={thread.updatedAt} locale={locale} /></span>
              <span className="v2-tcard__count">{ja ? `${thread.postCount}件の返信` : `${thread.postCount} replies`}</span>
            </p>
            <Link className="v2-tcard__title" href={`/v2/threads/${thread.id}`} onClick={() => recordThreadInterest(thread)}>{thread.title}</Link>
            {excerpt ? <p className="v2-tcard__excerpt">{excerpt}</p> : null}
            {recommended && !thread.pinned ? <V2DiscoveryOptions text={`${thread.title} ${(thread.tags ?? []).join(" ")} ${thread.boardKey}`} interests={interests} japanese={ja} dismiss={() => feedback.dismiss(thread.id)} fallbackReason={ja ? "公開スレッドの掲示板・タグ・活動情報から紹介しています。" : "Selected from public threads using board, tag and activity signals."} /> : null}
          </li>
        );
      })}
    </ul>
    {candidateQuery!==undefined&&recommended&&available.length>visibleCount?<button type="button" className="v2-btn" onClick={()=>setVisibleCount(n=>n+20)}>{ja?"もっと見る":"Show more"}</button>:null}
    </>
  );
}
