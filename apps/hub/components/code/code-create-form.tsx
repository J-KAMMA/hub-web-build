"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { CODE_LICENSE_CHOICES, codeCreateProblem, codeRepositoryHref } from "@/lib/code-ui";

export function CodeCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [securityPoc, setSecurityPoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = codeCreateProblem({ name: name.trim(), description: description.trim(), visibility, securityPoc });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/code/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), visibility }),
      });
      const payload = (await response.json().catch(() => null)) as { repository?: { owner: string; name: string }; error?: string } | null;
      if (response.ok && payload?.repository) {
        router.push(codeRepositoryHref(payload.repository.owner, payload.repository.name));
        return;
      }
      setError(response.status === 401 ? "ログインしてから作成してください。" : payload?.error || "リポジトリを作れませんでした。");
    } catch {
      setError("通信できませんでした。時間をおいて試してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="hub-code__form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="hub-code__field">
        <span>名前</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="off" spellCheck={false} required aria-describedby="code-name-help" />
        <small id="code-name-help">英数字と . _ - が使えます。例：my-game</small>
      </label>
      <label className="hub-code__field">
        <span>説明</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} />
        <small>{description.length} / 500</small>
      </label>
      <fieldset className="hub-code__field">
        <legend>公開範囲</legend>
        <label className="hub-code__choice"><input type="radio" name="visibility" checked={visibility === "private"} onChange={() => setVisibility("private")} />非公開：自分と共同作業者だけが見られます</label>
        <label className="hub-code__choice"><input type="radio" name="visibility" checked={visibility === "public"} onChange={() => setVisibility("public")} />公開：誰でも読めます。書き込みは許可した人だけです</label>
      </fieldset>
      <label className="hub-code__choice">
        <input type="checkbox" checked={securityPoc} onChange={(event) => setSecurityPoc(event.target.checked)} />
        セキュリティ研究の概念実証コードを含む
      </label>
      <p className="hub-code__note">概念実証は、説明を付けた公開リポジトリにだけ置けます。他人を攻撃する道具、認証情報、他人の個人情報、実行ファイルの添付は置けません。</p>
      <div className="hub-code__field">
        <span>ライセンス</span>
        <p className="hub-code__note">ライセンスはリポジトリの根に置く LICENSE ファイルで決めます。作成時の選択はまだありません。選べる種類：{CODE_LICENSE_CHOICES.join("、")}。指定しない場合、著作権は作者に残ります。</p>
      </div>
      {error ? <p className="hub-code__error" role="alert">{error}</p> : null}
      <div className="hub-code__actions">
        <button type="submit" className="hub-code__button hub-code__button--primary" disabled={busy}>{busy ? "作成しています" : "リポジトリを作る"}</button>
      </div>
    </form>
  );
}
