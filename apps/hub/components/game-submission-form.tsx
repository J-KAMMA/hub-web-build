"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import {
  UiButton,
  UiInput,
  UiLinkButton,
  UiSelect,
  UiStatePanel,
  UiTextarea,
} from "@/components/ui/primitives";

type ManagedCommunity = { id: string; name: string };
type Candidate = { id: string; slug: string; title: string; summary: string; status: "pending" | "published" | "rejected" };

const PLATFORM_OPTIONS = ["PC", "PlayStation 5", "PlayStation 4", "Xbox Series X|S", "Xbox One", "Nintendo Switch", "iOS", "Android", "その他"];

export function GameSubmissionForm({
  authenticated,
  communities,
  initialCommunityId = "",
  loginHref,
}: {
  authenticated: boolean;
  communities: ManagedCommunity[];
  initialCommunityId?: string;
  loginHref: string;
}) {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [aliases, setAliases] = useState("");
  const [summary, setSummary] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [communityId, setCommunityId] = useState(initialCommunityId);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const suggestSlug = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const checkCandidates = async () => {
    if (title.trim().length < 2) return setCandidates([]);
    const response = await fetch(`/api/games?q=${encodeURIComponent(title.trim())}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { games?: Candidate[] };
    setCandidates(payload.games ?? []);
  };
  const submit = () => {
    setError("");
    setSessionExpired(false);
    startTransition(async () => {
      try {
        const response = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          title: title.trim(), slug: slug.trim(), aliases: aliases.split(/[、,\n]/).map((value) => value.trim()).filter(Boolean), summary: summary.trim(), officialUrl: officialUrl.trim() || undefined,
          releaseDate: releaseDate || undefined, platforms, communityId: communityId || undefined,
        }) });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; game?: { id: string; title: string }; existing?: Candidate };
        if (!response.ok || !payload.game) {
          if (payload.existing) setCandidates([payload.existing]);
          if (response.status === 401) {
            setSessionExpired(true);
            return setError("ログイン状態を確認できませんでした。入力内容を保持したままログインし直せます。");
          }
          return setError(payload.error ?? "ゲームを登録できませんでした。");
        }
        setCreated(payload.game);
      } catch {
        setError("ゲームを登録できませんでした。接続を確認して、もう一度お試しください。");
      }
    });
  };

  if (!authenticated) return <UiStatePanel className="game-submission-auth" state="forbidden"
    title="ゲームを追加するにはログインが必要です"
    description="ログイン後、このページへ戻って作品情報を登録できます。"
    action={<UiLinkButton href={loginHref} tone="primary">ログインしてゲームを追加</UiLinkButton>}
  />;

  if (created) return <UiStatePanel className="game-submission-complete" state="success" title="ゲーム情報を受け付けました"
    description={<><strong>{created.title}</strong> は確認待ちです。公開確認が完了すると作品攻略ハブが作られます。</>}
    action={<div className="ui-state-actions"><UiLinkButton href={hubSurfacePath(surface, "/community")}>コミュニティへ戻る</UiLinkButton><UiButton type="button" tone="primary" onClick={() => setCreated(null)}>続けて登録</UiButton></div>}
  />;

  return <section className="game-submission-form">
    <header><p>攻略をまとめる作品情報を登録します。公式情報を確認できる内容だけ入力してください。</p></header>
    <div className="game-submission-form__grid">
      <label><span>作品名</span><UiInput value={title} onChange={(event) => { setTitle(event.target.value); if (!slug) setSlug(suggestSlug(event.target.value)); }} onBlur={checkCandidates} maxLength={120} placeholder="Fallout 4" /></label>
      <label><span>URL名</span><UiInput value={slug} onChange={(event) => setSlug(suggestSlug(event.target.value))} maxLength={80} placeholder="fallout-4" /><small>半角英数字とハイフン</small></label>
      <label className="game-submission-form__wide"><span>別名・略称</span><UiInput value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="FO4、フォールアウト4" /><small>読点またはカンマ区切り</small></label>
      <label className="game-submission-form__wide"><span>作品説明</span><UiTextarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} placeholder="ゲーム内容を20文字以上で説明" /></label>
      <label><span>公式URL</span><UiInput type="url" value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} placeholder="https://..." /></label>
      <label><span>発売日</span><UiInput type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label>
    </div>
    <fieldset><legend>対応機種</legend><div>{PLATFORM_OPTIONS.map((platform) => <label key={platform}><input type="checkbox" checked={platforms.includes(platform)} onChange={(event) => setPlatforms((current) => event.target.checked ? [...current, platform] : current.filter((value) => value !== platform))} />{platform}</label>)}</div></fieldset>
    {communities.length > 0 && <label className="game-submission-form__community"><span>管理しているコミュニティに紐付ける</span><UiSelect value={communityId} onChange={(event) => setCommunityId(event.target.value)}><option value="">あとで設定</option>{communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}</UiSelect></label>}
    {candidates.length > 0 && <aside className="game-submission-candidates"><strong>登録済みの可能性があります</strong>{candidates.map((candidate) => <div key={candidate.id}><span><b>{candidate.title}</b><small>{candidate.status === "published" ? "公開中" : candidate.status === "pending" ? "確認待ち" : "非公開"}</small></span>{candidate.status === "published" && <Link href={hubSurfacePath(surface, `/games/${candidate.slug}`)}>既存ページを見る</Link>}</div>)}</aside>}
    {error && <p className="community-error" role="alert">{error}{sessionExpired ? <> <Link href={loginHref}>ログインし直す</Link></> : null}</p>}
    <footer><Link href={hubSurfacePath(surface, "/community")}>キャンセル</Link><UiButton tone="primary" type="button" onClick={submit} pending={isPending} pendingLabel="送信中…" disabled={title.trim().length < 2 || summary.trim().length < 20 || !slug || platforms.length === 0}>確認待ちとして登録</UiButton></footer>
  </section>;
}
