"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

type Project = {
  id: string;
  title: string;
  artistName: string;
  primaryGenre: string;
  secondaryGenre: string;
  mood: string;
  targetBpm: number | null;
  generationMode: "human" | "ai_assisted";
  status: "draft" | "review" | "approved" | "rejected" | "archived";
  linkedUploadId?: string | null;
  updatedAt: string;
};
type Provenance = { id: string; sourceType: "human" | "ai_tool"; providerLabel: string; modelLabel: string; generationReceiptId: string; commercialUseAttested: number; termsReference: string; contributionSummary: string; createdAt: string };
type Review = { id: string; decision: "approved" | "rejected"; notes: string; createdAt: string };
type ProjectDetail = { project: Project; provenance: Provenance[]; reviews: Review[]; capabilities?: { aiPublicationEnabled: boolean } };

const API = "/music/api/studio/projects";

async function getAssertion() {
  const issue = () => fetch("/account/api/v1/assertions/music", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
  let response = await issue();
  let body = await response.json().catch(() => ({})) as { assertion?: string; error?: string };
  if (response.status === 403 && body.error === "music_link_required") {
    const linked = await fetch("/account/api/v1/links/music", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
    if (!linked.ok) throw new Error("Musicとの連携を完了できませんでした。");
    response = await issue();
    body = await response.json().catch(() => ({})) as { assertion?: string };
  }
  if (!response.ok || !body.assertion) throw new Error("ログインしてMusicを連携してください。");
  return body.assertion;
}

const statusLabel: Record<Project["status"], string> = {
  draft: "下書き", review: "審査中", approved: "承認済み", rejected: "要修正", archived: "保管",
};

export function MusicStudio() {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const [projects, setProjects] = useState<Project[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);

  async function load() {
    try {
      const assertion = await getAssertion();
      const response = await fetch(API, { cache: "no-store", headers: { authorization: `Bearer ${assertion}`, accept: "application/json" } });
      const body = await response.json() as { projects?: Project[] };
      if (!response.ok) throw new Error();
      setProjects(body.projects ?? []);
    } catch {
      setNotice("制作案件を読み込めませんでした。ログイン状態を確認してください。");
    }
  }

  useEffect(() => { void load(); }, []);

  async function openProject(id: string) {
    setBusy(true);
    setNotice("");
    try {
      const assertion = await getAssertion();
      const response = await fetch(`${API}/${encodeURIComponent(id)}`, { cache: "no-store", headers: { authorization: `Bearer ${assertion}`, accept: "application/json" } });
      const body = await response.json() as ProjectDetail;
      if (!response.ok || !body.project) throw new Error();
      setDetail(body);
    } catch {
      setNotice("案件の詳細を読み込めませんでした。");
    } finally { setBusy(false); }
  }

  async function projectAction(path: string, payload?: unknown) {
    if (!detail) return;
    setBusy(true);
    setNotice("");
    try {
      const assertion = await getAssertion();
      const response = await fetch(`${API}/${encodeURIComponent(detail.project.id)}/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${assertion}`, ...(payload === undefined ? {} : { "content-type": "application/json" }) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error);
      await Promise.all([load(), openProject(detail.project.id)]);
      setNotice(path === "submit" ? "審査へ提出しました。" : path === "review" ? "審査結果を保存しました。" : "生成元を登録しました。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setNotice(code === "provenance_incomplete" ? "商用利用を確認した生成元を先に登録してください。" : code === "approval_checks_incomplete" ? "承認には4項目すべての確認が必要です。" : "処理を完了できませんでした。");
    } finally { setBusy(false); }
  }

  function addProvenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sourceType = String(form.get("sourceType")) as "human" | "ai_tool";
    void projectAction("provenance", {
      sourceType,
      providerLabel: sourceType === "ai_tool" ? form.get("providerLabel") : "",
      modelLabel: sourceType === "ai_tool" ? form.get("modelLabel") : "",
      generationReceiptId: sourceType === "ai_tool" ? form.get("generationReceiptId") : "",
      commercialUseAttested: form.get("commercialUseAttested") === "on",
      termsReference: form.get("termsReference"),
      contributionSummary: form.get("contributionSummary"),
    });
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void projectAction("review", {
      decision: form.get("decision"),
      rightsChecked: form.get("rightsChecked") === "on",
      identityImitationChecked: form.get("identityImitationChecked") === "on",
      similarityChecked: form.get("similarityChecked") === "on",
      voiceConsentChecked: form.get("voiceConsentChecked") === "on",
      notes: form.get("notes"),
    });
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const assertion = await getAssertion();
      const response = await fetch(API, {
        method: "POST",
        headers: { authorization: `Bearer ${assertion}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"), artistName: form.get("artistName"), brief: form.get("brief"),
          primaryGenre: form.get("primaryGenre"), secondaryGenre: form.get("secondaryGenre"), mood: form.get("mood"),
          targetBpm: form.get("targetBpm") || null, generationMode: form.get("generationMode"),
        }),
      });
      const body = await response.json() as { project?: Project };
      if (!response.ok || !body.project) throw new Error();
      setProjects((items) => [body.project!, ...items]);
      event.currentTarget.reset();
      setNotice("制作案件を下書きとして作成しました。");
    } catch {
      setNotice("制作案件を作成できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="music-studio-page">
    <header>
      <div><p>企画、AI利用の出所、権利確認、公開前審査を一つの制作案件で管理します。</p></div>
      <nav><Link href={hubSurfacePath(surface, "/music")}>音楽へ戻る</Link><Link href={hubSurfacePath(surface, "/music/history")}>履歴</Link></nav>
    </header>
    <section className="music-studio-page__flow" aria-label="公開までの流れ">
      <span><b>1</b>企画</span><i>→</i><span><b>2</b>デモと出所</span><i>→</i><span><b>3</b>人が審査</span><i>→</i><span><b>4</b>安全検査・公開</span>
    </section>
    <div className="music-studio-page__columns">
      <form onSubmit={create}>
        <header><h2>新しい制作案件</h2><p>AIを使わない案件も同じ工程で管理できます。</p></header>
        <label>曲名<input name="title" required maxLength={120} /></label>
        <label>公開アーティスト名<input name="artistName" required maxLength={120} /></label>
        <label>制作方法<select name="generationMode" defaultValue="ai_assisted"><option value="ai_assisted">AI支援</option><option value="human">人による制作</option></select></label>
        <div><label>大ジャンル<input name="primaryGenre" maxLength={80} /></label><label>小ジャンル<input name="secondaryGenre" maxLength={80} /></label></div>
        <div><label>雰囲気<input name="mood" maxLength={80} /></label><label>BPM<input name="targetBpm" type="number" min={30} max={300} /></label></div>
        <label>企画メモ<textarea name="brief" rows={5} maxLength={2000} /></label>
        <button disabled={busy}>{busy ? "作成中…" : "下書きを作成"}</button>
      </form>
      <section>
        <header><div><h2>制作案件</h2><p>承認済みでも、音源は隔離検査を通るまで公開されません。</p></div><button type="button" onClick={() => void load()}>更新</button></header>
        {projects.length ? <ol>{projects.map((project) => <li key={project.id}>
          <button type="button" onClick={() => void openProject(project.id)}>
            <div><small>{project.primaryGenre || "ジャンル未設定"}{project.secondaryGenre ? ` / ${project.secondaryGenre}` : ""}</small><strong>{project.title}</strong><span>{project.artistName}</span></div>
            <div><b data-status={project.status}>{statusLabel[project.status]}</b><time>{new Date(project.updatedAt).toLocaleDateString("ja-JP")}</time></div>
          </button>
        </li>)}</ol> : <p className="music-studio-page__empty">制作案件はまだありません。</p>}
      </section>
    </div>
    {notice ? <p className="music-studio-page__notice" role="status">{notice}</p> : null}
    {detail ? <section className="music-studio-page__workflow">
      <header><div><h2>{detail.project.title}</h2><p>{detail.project.artistName}・{statusLabel[detail.project.status]}</p></div><button type="button" onClick={() => setDetail(null)}>閉じる</button></header>
      <div className="music-studio-page__workflow-grid">
        <section>
          <h3>生成元と人の作業</h3>
          {detail.provenance.length ? <ul>{detail.provenance.map((item) => <li key={item.id}><strong>{item.sourceType === "ai_tool" ? `${item.providerLabel} ${item.modelLabel}` : "人による制作"}</strong><span>{item.contributionSummary || "作業内容未記入"}</span><small>{item.commercialUseAttested ? "商用利用確認済み" : "利用条件未確認"}</small></li>)}</ul> : <p>まだ登録されていません。</p>}
          {["draft","rejected"].includes(detail.project.status) ? <form onSubmit={addProvenance}>
            <label>制作元<select name="sourceType" defaultValue={detail.project.generationMode === "ai_assisted" ? "ai_tool" : "human"}><option value="ai_tool">AIツール</option><option value="human">人による制作</option></select></label>
            <div><label>サービス名<input name="providerLabel" maxLength={120} /></label><label>モデル名<input name="modelLabel" maxLength={120} /></label></div>
            <label>生成受付ID<input name="generationReceiptId" maxLength={200} placeholder="AIサービスが発行した受付ID" /></label>
            <label>利用条件の参照<input name="termsReference" maxLength={500} placeholder="規約版・契約番号など" /></label>
            <label>人が行った編集<textarea name="contributionSummary" rows={3} maxLength={1000} /></label>
            <label className="music-studio-page__check"><input name="commercialUseAttested" type="checkbox" />この音源を商用利用できる条件を確認した</label>
            <button disabled={busy}>生成元を登録</button>
          </form> : null}
        </section>
        <section>
          <h3>公開前審査</h3>
          {detail.project.status === "draft" || detail.project.status === "rejected" ? <button type="button" disabled={busy || !detail.provenance.length} onClick={() => void projectAction("submit")}>審査へ提出</button> : null}
          {detail.project.status === "review" ? <form onSubmit={review}>
            <label className="music-studio-page__check"><input name="rightsChecked" type="checkbox" />使用素材と権利を確認した</label>
            <label className="music-studio-page__check"><input name="identityImitationChecked" type="checkbox" />実在人物のなりすましではない</label>
            <label className="music-studio-page__check"><input name="similarityChecked" type="checkbox" />既存作品との不自然な類似を確認した</label>
            <label className="music-studio-page__check"><input name="voiceConsentChecked" type="checkbox" />声を使う場合の本人同意を確認した</label>
            <label>判定<select name="decision"><option value="approved">承認</option><option value="rejected">要修正</option></select></label>
            <label>審査メモ<textarea name="notes" rows={3} maxLength={2000} /></label>
            <button disabled={busy}>審査結果を保存</button>
          </form> : null}
          {detail.project.status === "approved" ? <div className="music-studio-page__approved"><strong>制作審査を通過しました</strong>{detail.project.generationMode === "ai_assisted" && !detail.capabilities?.aiPublicationEnabled ? <><p>AI生成曲は現在、内部デモ専用です。配信・音楽ライブラリ利用について提供元の書面許可を確認するまで、Hub Musicの公開音源には関連付けできません。</p><small>公開ロック：有効</small></> : <><p>次に音源をアップロードします。ファイルは隔離領域へ入り、安全検査後にだけ公開できます。</p><Link href={hubSurfacePath(surface, "/music")}>音源をアップロード</Link>{detail.project.linkedUploadId ? <small>音源関連付け済み</small> : <small>音源の関連付けはアップロード完了後に行います。</small>}</>}</div> : null}
          {detail.reviews.length ? <ul>{detail.reviews.map((item) => <li key={item.id}><strong>{item.decision === "approved" ? "承認" : "要修正"}</strong><span>{item.notes || "メモなし"}</span><small>{new Date(item.createdAt).toLocaleString("ja-JP")}</small></li>)}</ul> : null}
        </section>
      </div>
    </section> : null}
    <aside><strong>AIの入力内容はMusicへ保存しません</strong><p>Musicが保持するのは、生成サービス側の受付ID、利用条件の参照、制作への人の関与、審査結果です。AIのプロンプトと生成履歴はAIサービス側で管理します。</p></aside>
  </section>;
}
