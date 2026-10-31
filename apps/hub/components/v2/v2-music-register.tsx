"use client";

import { useRouter } from "next/navigation";
import { normalizeTagList } from "@jkamma/content-tags";
import { V2TagInput } from "@/components/v2/v2-tag-input";
import { useState, useTransition } from "react";

/*
 * URL貼付からの登録。既存の music-discovery.tsx の submitWork から機能だけを抜いた。
 * 流れは既存と同じ: URL → /api/music/metadata で曲名と作者を取る → 確認して
 * POST /api/music。サイト内で再生できる YouTube / YouTube Music の URL が
 * 1件は要る（lib/music-source.ts の規則）。
 *
 * 2026-09-02、旦那様の決定で「登録は捨てない」。POST は 8月14日の統合で
 * 410 に置き換えられていたのを戻した。
 */
export function V2MusicRegister({ locale }: { locale: string }) {
  const ja = locale === "ja";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lookup = () => {
    const sourceUrl = url.trim();
    if (!sourceUrl || pending) return;
    startTransition(async () => {
      try {
        const response = await fetch("/api/music/metadata", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceUrl }),
        });
        const payload = await response.json().catch(() => ({})) as { metadata?: { title?: string; artist?: string; providerLabel?: string }; error?: string };
        if (!response.ok) throw new Error(payload.error || String(response.status));
        if (payload.metadata?.title) setTitle(payload.metadata.title);
        if (payload.metadata?.artist) setArtist(payload.metadata.artist);
        setMessage(payload.metadata?.title ? (ja ? `${payload.metadata.providerLabel ?? ""} から曲情報を取りました。確かめて登録してください。` : "Fetched details. Check and register.") : (ja ? "曲情報を取れなかったので、手で入れてください。" : "No details found. Fill them in."));
      } catch (caught) {
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "曲情報を取得できませんでした。" : "Could not fetch details."));
      }
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      try {
        const response = await fetch("/api/music", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            artist: artist.trim(),
            description: description.trim(),
            genre: genre.trim() || "未分類",
            tags: normalizeTagList(tags).map((tag) => tag.display),
            year: Number(year),
            serviceUrls: [url.trim()],
          }),
        });
        const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
        if (!response.ok) throw new Error(payload.error || String(response.status));
        setMessage(payload.message ?? (ja ? "登録しました。" : "Registered."));
        setUrl(""); setTitle(""); setArtist(""); setGenre(""); setTags([]);setDescription("");
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "登録できませんでした。" : "Could not register."));
      }
    });
  };

  return (
    <section className="v2-mreg" aria-label={ja ? "URLから登録" : "Register from a URL"}>
      <div className="v2-post__actions">
        <button type="button" className="v2-toggle v2-toggle--text" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? (ja ? "登録をやめる" : "Cancel") : (ja ? "URLから作品を登録" : "Register a work from a URL")}
        </button>
      </div>
      {message ? <p className="v2-note" role="status">{message}</p> : null}
      {open ? (
        <form className="v2-profile__edit" onSubmit={submit}>
          <label className="v2-profile__field">
            <span>{ja ? "配信先URL（YouTube / YouTube Music）" : "Source URL (YouTube / YouTube Music)"}</span>
            <div className="v2-dm__start-row">
              <input className="v2-reply__input" type="url" value={url} maxLength={2048} placeholder="https://www.youtube.com/watch?v=…" required onChange={(event) => setUrl(event.target.value)} />
              <button type="button" className="v2-toggle v2-toggle--text" disabled={!url.trim() || pending} onClick={lookup}>{ja ? "曲情報を取る" : "Fetch"}</button>
            </div>
          </label>
          <label className="v2-profile__field"><span>{ja ? "曲名・作品名" : "Title"}</span><input className="v2-reply__input" value={title} maxLength={180} required onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="v2-profile__field"><span>{ja ? "アーティスト" : "Artist"}</span><input className="v2-reply__input" value={artist} maxLength={120} required onChange={(event) => setArtist(event.target.value)} /></label>
          <div className="v2-profile__link-row">
            <label className="v2-profile__field"><span>{ja ? "ジャンル" : "Genre"}</span><input className="v2-reply__input" value={genre} maxLength={60} placeholder={ja ? "未分類" : "Uncategorised"} onChange={(event) => setGenre(event.target.value)} /></label>
            <label className="v2-profile__field"><span>{ja ? "リリース年" : "Year"}</span><input className="v2-reply__input" type="number" min={1000} max={new Date().getFullYear() + 1} value={year} required onChange={(event) => setYear(event.target.value)} /></label>
            <span />
          </div>
          <div className="v2-profile__field"><V2TagInput value={tags} onChange={setTags} label={ja ? "タグ" : "Tags"} /></div>
          {/* 説明はサーバーが必須にしている（lib/music-source.ts の text()）。空で送ると400。 */}
          <label className="v2-profile__field"><span>{ja ? "説明（必須、500字まで）" : "Description (required, up to 500)"}</span><textarea className="v2-reply__input" value={description} maxLength={500} rows={2} required onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="v2-reply__footer">
            <button type="submit" className="v2-reply__submit" disabled={pending || !url.trim() || !title.trim() || !artist.trim() || !description.trim()}>{ja ? "登録" : "Register"}</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
