"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { GameStoreSettings } from "@/components/game-store-settings";
import { optimizeImageFile, SQUARE_AVATAR_PRESET } from "@/lib/client-image-optimizer";

type Game = { id: string; slug: string; title: string; summary?: string | null; image_url?: string | null; platforms?: string | null };
type Props = { communityId: string; onClose(): void };

export function CommunityGameManager({ communityId, onClose }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [results, setResults] = useState<Game[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"link" | "edit" | "update" | "image" | "store">("link");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [gameState, setGameState] = useState<"loading" | "ready" | "error">("loading");
  const [gameRetry, setGameRetry] = useState(0);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [edit, setEdit] = useState({ title: "", summary: "", reason: "" });
  const editRef = useRef(edit);
  editRef.current = edit;
  const [update, setUpdate] = useState({ versionLabel: "", title: "", releasedAt: "", officialUrl: "" });
  const [image, setImage] = useState({ dataUrl: "", rightsBasis: "user_created", attribution: "" });
  const [imageState, setImageState] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  const mounted = useRef(true);
  const action = useRef(false);
  const actionId = useRef(0);
  const imageRequest = useRef(0);
  const gameRead = useRef(0);
  const gameLoading = useRef(false);
  const searchRequest = useRef(0);
  const scope = useRef(0);
  const scopeCommunity = useRef(communityId);
  const queryRef = useRef(query);
  queryRef.current = query;
  if (scopeCommunity.current !== communityId) {
    scopeCommunity.current = communityId;
    scope.current += 1;
    action.current = false;
  }

  function isGame(value: unknown): value is Game {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.slug === "string" && candidate.slug.length > 0 && typeof candidate.title === "string" && candidate.title.length > 0
      && [candidate.summary, candidate.image_url, candidate.platforms].every((field) => field == null || typeof field === "string");
  }

  function isCurrent(requestScope: number, requestId?: number) {
    return mounted.current && scope.current === requestScope && (requestId === undefined || actionId.current === requestId);
  }

  function startAction() {
    if (!mounted.current || action.current) return null;
    action.current = true;
    const id = ++actionId.current;
    setBusy(true);
    return { id, scope: scope.current };
  }

  function finishAction(request: { id: number; scope: number }) {
    if (isCurrent(request.scope, request.id)) {
      action.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    setResults([]);
    setQuery("");
    setSearchState("idle");
    setMessage("");
    setEdit({ title: "", summary: "", reason: "" });
    setUpdate({ versionLabel: "", title: "", releasedAt: "", officialUrl: "" });
    setImage({ dataUrl: "", rightsBasis: "user_created", attribution: "" });
    setImageState("idle");
  }, [communityId]);

  useEffect(() => {
    mounted.current = true;
    const requestScope = scope.current;
    const read = ++gameRead.current;
    gameLoading.current = true;
    setBusy(false);
    setGame(null);
    setGameState("loading");
    void fetch(`/api/communities/${communityId}/game`).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { game?: unknown };
      if (!("game" in data) || (data.game !== null && !isGame(data.game))) throw new Error();
      if (isCurrent(requestScope) && read === gameRead.current) {
        setGame(data.game as Game | null);
        setGameState("ready");
      }
    }).catch(() => {
      if (isCurrent(requestScope) && read === gameRead.current) setGameState("error");
    }).finally(() => {
      if (isCurrent(requestScope) && read === gameRead.current) gameLoading.current = false;
    });
    return () => { mounted.current = false; };
  }, [communityId, gameRetry]);

  async function search() {
    const searchedQuery = query.trim();
    if (searchedQuery.length < 2) return;
    const request = startAction();
    if (!request) return;
    const read = ++searchRequest.current;
    setSearchState("loading");
    try {
      const response = await fetch(`/api/games?q=${encodeURIComponent(searchedQuery)}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { games?: unknown };
      if (!Array.isArray(data.games) || !data.games.every(isGame)) throw new Error();
      if (isCurrent(request.scope, request.id) && read === searchRequest.current && queryRef.current.trim() === searchedQuery) {
        setResults(data.games);
        setSearchState("ready");
      }
    } catch {
      if (isCurrent(request.scope, request.id) && read === searchRequest.current && queryRef.current.trim() === searchedQuery) setSearchState("error");
    } finally {
      finishAction(request);
    }
  }

  async function link(selected: Game) {
    const request = startAction();
    if (!request) return;
    setMessage("");
    try {
      const response = await fetch(`/api/games/${selected.id}/communities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ communityId }) });
      if (!response.ok) {
        if (isCurrent(request.scope, request.id)) setMessage("ゲーム連携できませんでした。");
        return;
      }
      const result = await response.json().catch(() => null) as { linked?: unknown } | null;
      if (response.status !== 200 || result?.linked !== true) {
        if (isCurrent(request.scope, request.id)) setMessage("ゲーム連携の送信結果を確認できませんでした。");
        return;
      }
      if (isCurrent(request.scope, request.id)) {
        gameRead.current += 1;
        gameLoading.current = false;
        setGame(selected);
        setGameState("ready");
        setMessage("ゲームを連携しました。");
      }
    } catch {
      if (isCurrent(request.scope, request.id)) setMessage("ゲーム連携の送信結果を確認できませんでした。");
    } finally {
      finishAction(request);
    }
  }
  async function proposeEdit() {
    if (!game) return;
    const submitted = {
      title: edit.title.trim(),
      summary: edit.summary.trim(),
      reason: edit.reason.trim().slice(0, 500),
    };
    if ((!submitted.title && !submitted.summary) || !submitted.reason) return;
    const request = startAction();
    if (!request) return;
    setMessage("");
    try {
      const response = await fetch(`/api/games/${game.id}/edits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: { title: submitted.title || undefined, summary: submitted.summary || undefined }, reason: submitted.reason }),
      });
      const result = response?.ok === true ? await response.json().catch(() => null) as { created?: unknown } | null : null;
      if (response?.status === 201 && result?.created === true && isCurrent(request.scope, request.id)) {
        setMessage("編集提案を送信しました。");
        if (editRef.current.title.trim() === submitted.title && editRef.current.summary.trim() === submitted.summary && editRef.current.reason.trim().slice(0, 500) === submitted.reason) {
          setEdit({ title: "", summary: "", reason: "" });
        }
      } else if (response?.ok === true && isCurrent(request.scope, request.id)) {
        setMessage("編集提案の送信結果を確認できませんでした。");
      } else if (isCurrent(request.scope, request.id)) {
        setMessage("編集提案を送信できませんでした。");
      }
    } catch {
      if (isCurrent(request.scope, request.id)) setMessage("編集提案の送信結果を確認できませんでした。");
    } finally {
      finishAction(request);
    }
  }
  async function addUpdate() {
    if (!game || !update.versionLabel.trim() || !update.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(update.releasedAt)) return;
    const request = startAction();
    if (!request) return;
    setMessage("");
    try {
      const response = await fetch(`/api/games/${game.id}/updates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(update) });
      if (!response.ok) {
        if (isCurrent(request.scope, request.id)) setMessage("更新情報を登録できませんでした。");
        return;
      }
      const result = await response.json().catch(() => null) as { created?: unknown; guidesMarkedForRecheck?: unknown } | null;
      if (response.status !== 201 || result?.created !== true || result.guidesMarkedForRecheck !== true) {
        if (isCurrent(request.scope, request.id)) setMessage("更新情報の送信結果を確認できませんでした。");
        return;
      }
      if (isCurrent(request.scope, request.id)) setMessage("更新を登録し、攻略を再検証待ちにしました。");
    } catch {
      if (isCurrent(request.scope, request.id)) setMessage("更新情報の送信結果を確認できませんでした。");
    } finally {
      finishAction(request);
    }
  }

  async function prepareImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const requestScope = scope.current;
    const request = ++imageRequest.current;
    event.currentTarget.value = "";
    setMessage("");
    setImage((current) => ({ ...current, dataUrl: "" }));
    setImageState("preparing");
    try {
      const optimized = await optimizeImageFile(file, SQUARE_AVATAR_PRESET);
      if (isCurrent(requestScope) && request === imageRequest.current) {
        setImage((current) => ({ ...current, dataUrl: optimized.dataUrl }));
        setImageState("ready");
      }
    } catch {
      if (isCurrent(requestScope) && request === imageRequest.current) {
        setImageState("error");
        setMessage("画像を準備できませんでした。");
      }
    }
  }

  async function uploadImage() {
    if (!game || imageState !== "ready" || !image.dataUrl || (image.rightsBasis !== "user_created" && !image.attribution.trim())) return;
    const request = startAction();
    if (!request) return;
    setMessage("");
    try {
      const response = await fetch(`/api/games/${game.id}/image`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageDataUrl: image.dataUrl, rightsBasis: image.rightsBasis, attribution: image.attribution }) });
      if (!response.ok) {
        if (isCurrent(request.scope, request.id)) setMessage("画像を更新できませんでした。");
        return;
      }
      const result = await response.json().catch(() => null) as { imageUrl?: unknown } | null;
      const imageUrl = result?.imageUrl;
      if (response.status !== 200 || typeof imageUrl !== "string" || !imageUrl) {
        if (isCurrent(request.scope, request.id)) setMessage("画像更新の送信結果を確認できませんでした。");
        return;
      }
      if (isCurrent(request.scope, request.id)) {
        setGame((current) => current ? { ...current, image_url: imageUrl } : current);
        setMessage("ゲーム画像を更新しました。");
      }
    } catch {
      if (isCurrent(request.scope, request.id)) setMessage("画像更新の送信結果を確認できませんでした。");
    } finally {
      finishAction(request);
    }
  }

  return <div className="community-modal-backdrop" role="presentation"><section className="community-modal community-game-manager" role="dialog" aria-modal="true" aria-labelledby="community-game-title"><header><div><span>GAME GUIDE</span><h2 id="community-game-title">ゲーム攻略の設定</h2></div><button type="button" onClick={onClose} aria-label="閉じる">×</button></header>
    {gameState === "loading" && <p role="status">連携中のゲームを読み込んでいます。</p>}
    {gameState === "error" && <p role="alert">連携中のゲームを確認できませんでした。<button type="button" onClick={() => { if (!gameLoading.current) { gameLoading.current = true; setGameRetry((value) => value + 1); } }} disabled={busy}>再試行</button></p>}
    {game && <div className="community-game-manager__current">{game.image_url && <img src={game.image_url} alt="" />}<div><small>連携中</small><strong>{game.title}</strong><a href={`/games/${game.slug}`}>公開ページを見る</a></div></div>}
    <nav>{(["link","edit","update","image","store"] as const).map((value) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "link" ? "ゲーム連携" : value === "edit" ? "情報の提案" : value === "update" ? "更新情報" : value === "image" ? "画像" : "ストア"}</button>)}</nav>
    {tab === "link" && <div className="community-game-manager__form"><label><span>ゲームを検索</span><input value={query} onChange={(e) => { searchRequest.current += 1; setQuery(e.target.value); setResults([]); setSearchState("idle"); }} /></label><button type="button" onClick={search} disabled={busy || query.trim().length < 2}>検索</button>{searchState === "loading" && <p role="status">ゲームを検索しています。</p>}{searchState === "error" && <p role="alert">ゲーム検索結果を確認できませんでした。<button type="button" onClick={search} disabled={busy}>再試行</button></p>}{searchState === "ready" && results.length === 0 && <p>該当するゲームはありません。</p>}{results.map((entry) => <button className="community-game-manager__result" type="button" key={entry.id} onClick={() => link(entry)} disabled={busy}><strong>{entry.title}</strong><small>{entry.summary}</small></button>)}<a href={`/games/new?community=${communityId}`}>見つからないゲームを追加</a></div>}
    {tab === "edit" && <div className="community-game-manager__form"><label><span>作品名（変更時のみ）</span><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label><label><span>説明（変更時のみ）</span><textarea value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} /></label><label><span>変更理由</span><textarea maxLength={500} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></label><button type="button" onClick={proposeEdit} disabled={!game || (!edit.title.trim() && !edit.summary.trim()) || !edit.reason.trim() || busy}>編集を提案</button></div>}
    {tab === "update" && <div className="community-game-manager__form"><label><span>バージョン</span><input value={update.versionLabel} onChange={(e) => setUpdate({ ...update, versionLabel: e.target.value })} /></label><label><span>更新内容</span><input value={update.title} onChange={(e) => setUpdate({ ...update, title: e.target.value })} /></label><label><span>配信日</span><input type="date" value={update.releasedAt} onChange={(e) => setUpdate({ ...update, releasedAt: e.target.value })} /></label><label><span>公式URL</span><input type="url" value={update.officialUrl} onChange={(e) => setUpdate({ ...update, officialUrl: e.target.value })} /></label><button type="button" onClick={addUpdate} disabled={!game || !update.versionLabel.trim() || !update.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(update.releasedAt) || busy}>登録して再検証を依頼</button></div>}
    {tab === "image" && <div className="community-game-manager__form"><label><span>画像</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={prepareImage} /></label>{imageState === "preparing" && <p role="status">画像を準備しています。</p>}<label><span>利用根拠</span><select value={image.rightsBasis} onChange={(e) => setImage({ ...image, rightsBasis: e.target.value })}><option value="user_created">自作画像</option><option value="official_permission">公式の利用許可</option><option value="licensed">ライセンス取得済み</option></select></label><label><span>権利者・出典</span><input value={image.attribution} onChange={(e) => setImage({ ...image, attribution: e.target.value })} /></label><button type="button" onClick={uploadImage} disabled={!game || imageState !== "ready" || !image.dataUrl || (image.rightsBasis !== "user_created" && !image.attribution.trim()) || busy}>画像を更新</button></div>}
    {tab === "store" && (game ? <GameStoreSettings key={game.id} gameId={game.id} /> : <p>先にゲームを連携してください。</p>)}
    {message && <p role="status">{message}</p>}
  </section></div>;
}
