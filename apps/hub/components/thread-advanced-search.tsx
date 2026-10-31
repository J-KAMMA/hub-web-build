export function ThreadAdvancedSearch({ threadId, layout = "flat", sort = "best", values }: { threadId: string; layout?: "flat" | "tree"; sort?: string; values: { q: string; author: string; role: string; minScore?: number; source: boolean; from?: string; to?: string } }) {
  const active = Boolean(values.author || values.role !== "all" || values.minScore != null || values.source || values.from || values.to);
  return <details className="thread-advanced-search" open={active}>
    <summary>絞り込み{active ? "（適用中）" : ""}</summary>
    <form action={`/threads/${threadId}`} method="get" className="thread-search__advanced">
      <input type="hidden" name="layout" value={layout} />
      {layout === "tree" ? <input type="hidden" name="sort" value={sort} /> : null}
      <label>本文<input type="search" name="q" defaultValue={values.q} placeholder="本文・レス番号" /></label>
      <label>投稿者<input name="author" defaultValue={values.author} placeholder="名前・@ID" /></label>
      <label>最低スコア<input name="minScore" type="number" defaultValue={values.minScore} /></label>
      <label>レスの種類<select name="role" defaultValue={values.role}><option value="all">すべて</option><option value="answer">回答</option><option value="context">補足</option><option value="counterpoint">異なる見方</option><option value="question">質問</option><option value="correction">訂正</option><option value="source">出典</option></select></label>
      <label>開始日<input name="dateFrom" type="date" defaultValue={values.from} /></label>
      <label>終了日<input name="dateTo" type="date" defaultValue={values.to} /></label>
      <label className="thread-search__check"><input name="source" type="checkbox" value="1" defaultChecked={values.source} />出典ありのみ</label>
      <button type="submit">適用</button><a href={`/threads/${threadId}`}>解除</a>
    </form>
  </details>;
}
