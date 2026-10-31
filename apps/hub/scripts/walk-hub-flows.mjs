/*
 * Hub の「流れ」を歩いて確かめる（2026-09-04、旦那様「サイトのすべてのユースケースと
 * 流れの確認と実装」）。
 *
 * scripts/smoke.mjs との違い: あれは「その道は返るか」を聞く。ここは
 * **「その旅は繋がっているか」**を聞く。構想（docs/HUB_SYSTEM_MAP.md 第22章）が
 * Hub の中核と書いている循環を、段ごとに順番に叩く:
 *
 *   A 収益化: 投稿 → Action Card → 取引・仕事 → 権利・成果・実績 → 次の投稿
 *   B 知識:   投稿 → 議論 → 出典確認 → Hubpedia → 研究課題 → 人材・データ・計算・資金
 *   C 自律実行と持ち出し: 意図 → 承認 → 所有サービス → 結果証明 → Hub、そして出口と入口
 *
 * 段が1つ欠けると旅は成立しないが、画面ごとの検査ではどれも緑になる。
 * だから段の**並び**で見る。
 *
 * 使い方: node scripts/walk-hub-flows.mjs [--base http://localhost:3111]
 * 書き込みはしない。読むだけで、投稿も注文も作らない。
 */

const baseIndex = process.argv.indexOf("--base");
const BASE = (baseIndex >= 0 ? process.argv[baseIndex + 1] : process.env.HUB_FLOW_BASE_URL) ?? "http://localhost:3111";

async function get(path, accept = "text/html") {
  const response = await fetch(BASE + path, { headers: { accept, origin: BASE, referer: BASE + "/v2" } });
  return { status: response.status, text: await response.text() };
}

async function api(path) {
  const response = await fetch(BASE + path, {
    headers: { accept: "application/json", origin: BASE, referer: BASE + "/v2" },
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* HTML が返ることもある */ }
  return { status: response.status, body };
}

/* 認証や作法で弾かれた（401/403/405）のは「入口が在る」。無い（404）とは分ける。 */
const reachable = (status) => status !== 404 && status < 500;

/*
 * 非常停止のつまみ（lib/hub-request-policy.ts）で止めてある機能は 503 を返す。
 * .dev.vars の HUB_ADVERTISING_ENABLED=false などがそれで、**欠陥ではない**。
 * 止めてあることと壊れていることを取り違えないよう、印だけ変えて数え上げる。
 */
function paused(result) {
  return result.status === 503 && typeof result.body?.error === "string" && result.body.error.includes("一時停止中");
}

const FLOWS = [
  ["A 収益化", [
    ["投稿が読める", async () => {
      const r = await api("/api/social/posts");
      return [r.status === 200, `GET /api/social/posts ${r.status}`];
    }],
    ["仕事のURLが Action Card になる", async () => {
      const r = await api(`/api/link-preview?url=${encodeURIComponent(`${BASE}/work?listing=probe`)}`);
      const action = r.body?.action;
      return [Boolean(action), action ? `${action.type} / ${action.ownerService} / ${action.status}` : `投影なし ${r.status}`];
    }],
    ["商品のURLが Action Card になる", async () => {
      const r = await api(`/api/link-preview?url=${encodeURIComponent(`${BASE}/market/products/probe`)}`);
      const action = r.body?.action;
      return [action?.type === "purchase", action ? `${action.type} / ${action.ownerService} / ${action.status}` : `投影なし ${r.status}`];
    }],
    ["仕事の入口", async () => {
      const r = await get("/v2/work");
      return [r.status === 200, `/v2/work ${r.status}`];
    }],
    ["ストアの入口", async () => {
      const r = await get("/v2/store");
      return [r.status === 200, `/v2/store ${r.status}`];
    }],
    ["購入の引き渡し", async () => {
      const r = await api("/api/core/commerce/handoff");
      return [reachable(r.status), `/api/core/commerce/handoff ${r.status}`];
    }],
    ["納品の証明", async () => {
      const r = await api("/api/creator/work-proof");
      return [reachable(r.status), `/api/creator/work-proof ${r.status}`];
    }],
    ["取引の証明", async () => {
      const r = await api("/api/creator/commerce-proof");
      return [reachable(r.status), `/api/creator/commerce-proof ${r.status}`];
    }],
    ["実績が本人の画面に出る", async () => {
      const r = await get("/v2/creator");
      return [r.status === 200 && r.text.includes("Hub Trust"), `/v2/creator ${r.status}`];
    }],
    ["実績が他人から見える", async () => {
      const r = await get("/v2/profile/jkamma");
      return [r.status === 200 && r.text.includes("v2-trust"), `/v2/profile/jkamma ${r.status} 文脈別実績=${r.text.includes("v2-trust")}`];
    }],
    ["投げ銭の受け取り", async () => {
      const r = await api("/api/tips/settings");
      return [reachable(r.status), `/api/tips/settings ${r.status}`];
    }],
  ]],
  ["B 知識", [
    ["議論の入口", async () => {
      const r = await get("/v2/bbs");
      return [r.status === 200, `/v2/bbs ${r.status}`];
    }],
    ["議論から記事候補", async () => {
      const r = await api("/api/hubpedia/candidates");
      return [reachable(r.status), `/api/hubpedia/candidates ${r.status}`];
    }],
    ["Hubpedia の入口", async () => {
      const r = await get("/v2/hubpedia");
      return [r.status === 200, `/v2/hubpedia ${r.status}`];
    }],
    ["出典つきの検索", async () => {
      const r = await api(`/api/hubpedia/v1/search?q=${encodeURIComponent("研究")}`);
      return [r.status === 200, `/api/hubpedia/v1/search ${r.status}`];
    }],
    ["研究課題の入口", async () => {
      const r = await get("/v2/research");
      return [r.status === 200, `/v2/research ${r.status}`];
    }],
    ["計算の入口", async () => {
      const r = await get("/v2/compute");
      return [r.status === 200, `/v2/compute ${r.status}`];
    }],
    /*
     * 研究データ。**Hub Data はまだ独立サービスとして無い**（構想 第12章「将来の専門サービス」）。
     * いまデータセットが在るのは研究プロジェクトの中（RESEARCH_OBJECT_TYPES の dataset）。
     * ここを /v2/data で見に行くと、設計が約束していないものを欠陥として数えてしまう。
     */
    ["研究データ（いまは研究プロジェクトの中）", async () => {
      /*
       * 「データセット」の字が出るのは研究プロジェクトの中（/v2/research/[projectId]）で、
       * 一覧には出ない。プロジェクトが1件も無い環境でも歩けるように、置き場の有無で見る。
       */
      const index = await get("/v2/research");
      const projects = await api("/api/research/projects");
      return [index.status === 200 && projects.status === 200,
        `/v2/research ${index.status} · /api/research/projects ${projects.status}（データセットはこの中の研究オブジェクト）`];
    }],
    ["人材（協力者募集）", async () => {
      const r = await get("/v2/work");
      return [r.status === 200, `/v2/work ${r.status}`];
    }],
    ["資金", async () => {
      const r = await get("/v2/market");
      return [r.status === 200, `/v2/market ${r.status}`];
    }],
  ]],
  ["C 自律実行と持ち出し", [
    ["意図の入口", async () => {
      const r = await get("/v2/intent");
      return [r.status === 200, `/v2/intent ${r.status}`];
    }],
    ["意図の一覧", async () => {
      const r = await api("/api/core/intents");
      return [reachable(r.status), `/api/core/intents ${r.status}`];
    }],
    ["結果証明の受け口", async () => {
      const r = await api("/api/core/intents/owner-result");
      return [reachable(r.status), `/api/core/intents/owner-result ${r.status}`];
    }],
    ["出口（持ち出し）", async () => {
      const r = await api("/api/account/data-export");
      return [r.status === 200, `/api/account/data-export ${r.status}`];
    }],
    ["入口（復元）", async () => {
      const r = await api("/api/core/personal-node/import");
      return [reachable(r.status), `/api/core/personal-node/import ${r.status}`];
    }],
  ]],
  ["D 交流（読む・書く・話す）", [
    ["フィード", async () => {
      const r = await get("/v2");
      return [r.status === 200, `/v2 ${r.status}`];
    }],
    ["投稿の詳細", async () => {
      const r = await get("/v2/posts/probe");
      return [r.status !== 500, `/v2/posts/[id] ${r.status}`];
    }],
    ["スレッドの投稿", async () => {
      const r = await api("/api/bbs/threads");
      return [r.status === 200, `/api/bbs/threads ${r.status}`];
    }],
    ["コミュニティ", async () => {
      const page = await get("/v2/community");
      const list = await api("/api/communities");
      return [page.status === 200 && list.status === 200, `/v2/community ${page.status} · /api/communities ${list.status}`];
    }],
    ["メッセージ", async () => {
      const page = await get("/v2/messages");
      const list = await api("/api/messages/conversations");
      return [page.status === 200 && reachable(list.status), `/v2/messages ${page.status} · 会話 ${list.status}`];
    }],
    ["通知", async () => {
      const page = await get("/v2/notifications");
      const list = await api("/api/notifications");
      return [page.status === 200 && reachable(list.status), `/v2/notifications ${page.status} · ${list.status}`];
    }],
    ["通報の受け口", async () => {
      const r = await api("/api/social/posts/probe/report");
      return [reachable(r.status), `/api/social/posts/[id]/report ${r.status}`];
    }],
  ]],
  ["E 見つける", [
    ["検索", async () => {
      const page = await get("/v2/search?q=" + encodeURIComponent("研究"));
      const result = await api("/api/search?q=" + encodeURIComponent("研究"));
      return [page.status === 200 && result.status === 200, `/v2/search ${page.status} · /api/search ${result.status}`];
    }],
    ["タグの横断", async () => {
      const page = await get("/v2/tag/" + encodeURIComponent("音楽"));
      const list = await api("/api/tags");
      return [page.status === 200 && reachable(list.status), `/v2/tag/[tag] ${page.status} · /api/tags ${list.status}`];
    }],
    ["記事", async () => {
      const r = await get("/v2/articles");
      return [r.status === 200, `/v2/articles ${r.status}`];
    }],
  ]],
  ["F 見る・聴く・持つ", [
    ["動画", async () => {
      const page = await get("/v2/videos");
      const list = await api("/api/videos");
      return [page.status === 200 && list.status === 200, `/v2/videos ${page.status} · /api/videos ${list.status}`];
    }],
    ["音楽", async () => {
      const page = await get("/v2/music");
      const list = await api("/api/music");
      return [page.status === 200 && list.status === 200, `/v2/music ${page.status} · /api/music ${list.status}`];
    }],
    ["ゲーム", async () => {
      const page = await get("/v2/games");
      const list = await api("/api/games");
      return [page.status === 200 && list.status === 200, `/v2/games ${page.status} · /api/games ${list.status}`];
    }],
  ]],
  ["G 稼ぐ", [
    ["Creator Center", async () => {
      const r = await get("/v2/creator");
      return [r.status === 200, `/v2/creator ${r.status}`];
    }],
    ["収益の内訳", async () => {
      const page = await get("/v2/earnings");
      const policy = await api("/api/monetization");
      return [page.status === 200 && reachable(policy.status), `/v2/earnings ${page.status} · /api/monetization ${policy.status}`];
    }],
    ["広告（出す側）", async () => {
      const page = await get("/v2/advertising");
      const dashboard = await api("/api/ads/advertiser/dashboard");
      const ok = page.status === 200 && (reachable(dashboard.status) || paused(dashboard));
      return [ok, `/v2/advertising ${page.status} · 出稿 ${paused(dashboard) ? "停止中(503)" : dashboard.status}`];
    }],
    ["広告（出る側）", async () => {
      const r = await api("/api/ads/serve");
      return [reachable(r.status) || paused(r), `/api/ads/serve ${paused(r) ? "停止中(503)" : r.status}`];
    }],
  ]],
  ["H 自分", [
    ["プロフィール", async () => {
      const r = await api("/api/profile");
      return [reachable(r.status), `/api/profile ${r.status}`];
    }],
    ["設定", async () => {
      const r = await get("/v2/settings");
      return [r.status === 200, `/v2/settings ${r.status}`];
    }],
    ["安全の設定", async () => {
      const r = await api("/api/profile/safety");
      return [reachable(r.status), `/api/profile/safety ${r.status}`];
    }],
    ["退会の受け口", async () => {
      const r = await api("/api/account/deletion-request");
      return [reachable(r.status), `/api/account/deletion-request ${r.status}`];
    }],
  ]],
  ["I ウォレットと価値", [
    ["ウォレット連携", async () => {
      const r = await get("/v2/account/payment");
      return [reachable(r.status), `/v2/account/payment ${r.status}`];
    }],
    ["トークンの順位", async () => {
      const page = await get("/v2/token");
      const list = await api("/api/token-rankings");
      return [page.status === 200 && reachable(list.status), `/v2/token ${page.status} · 順位 ${list.status}`];
    }],
    ["投げ銭の履歴", async () => {
      const r = await api("/api/tips/history");
      return [reachable(r.status), `/api/tips/history ${r.status}`];
    }],
  ]],
];

let passed = 0;
let total = 0;
/*
 * **届かなかったのは欠陥ではない**（2026-09-04）。
 * サーバーを入れ直している最中にこれを走らせたら、全段が「NG 例外: fetch failed」に
 * なり、19件の偽の欠陥として上へ流れた。届かなかった段は ?? として数え、
 * 最後に「測れていない」と言う。旅が繋がっていないことと混同しない。
 */
let unreachable = 0;

for (const [flow, steps] of FLOWS) {
  console.log(`\n## ${flow}`);
  for (const [name, run] of steps) {
    total += 1;
    let ok = false;
    let note = "";
    let reached = true;
    try {
      [ok, note] = await run();
    } catch (error) {
      /* fetch そのものが失敗＝サーバーへ届いていない。 */
      reached = !/fetch failed|ECONNREFUSED|terminated|aborted/i.test(String(error.message));
      note = `例外: ${error.message}`;
    }
    if (ok) passed += 1;
    if (!reached) unreachable += 1;
    console.log(`${ok ? "OK  " : reached ? "NG  " : "??  "} ${name} — ${note}`);
  }
}
console.log(`\n通った ${passed} / ${total}`);
if (unreachable) {
  console.log(`**${unreachable} 段はサーバーへ届かなかった。この回は当てにならない。**`);
  console.log("開発サーバーが落ち着いてから測り直す。");
}
process.exitCode = passed === total ? 0 : 1;
