import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "data", "sekai-seifu-db.json");
const sqlPath = path.join(root, "data", ".generated-dev-feed-posts.sql");

const authors = [
  { id: "profile-me", displayName: "J Kamma", handle: "jkamma" },
  { id: "profile-noa", displayName: "Noa", handle: "noa_threads" },
  { id: "profile-rin", displayName: "Rin", handle: "rin_cipher" },
  { id: "profile-yoru", displayName: "Yoru", handle: "yoru_observer" },
];

const themes = [
  ["フィード設計", "情報量が増えても読む順番を見失わないよう、見出し・本文・反応の強弱を見直しています。"],
  ["Hubpedia", "出典と要約を行き来しやすくして、気になった点をそのままスレッドで話せる流れを試しています。"],
  ["コミュニティ", "質問、雑談、攻略、募集を分けつつ、参加したばかりでも入口が分かる構成を考えています。"],
  ["検索", "検索語が曖昧なときも、関連する人・記事・スレッドを比べながら探せる表示が理想です。"],
  ["プロフィール", "固定ポストと活動タブがあると、その人が何を考え何を作っているか短時間で分かります。"],
  ["動画", "埋め込みで内容を確かめたあと、元サイトへ迷わず移動できる操作を大切にしています。"],
  ["音楽", "サービスをまたいで作品を見つけても、再生元と権利関係が常に分かる見せ方が必要です。"],
  ["ショッピング", "価格だけでなく販売元、更新日時、外部リンクであることを並べて比較できるようにしたいです。"],
  ["通知", "重要な返信を見逃さず、反応が多いときは通知に追われない粒度へ調整したいです。"],
  ["安全性", "公開範囲やブロック状態を操作前に確認でき、迷ったときは安全側になる設計を続けます。"],
];

const angles = [
  "まず小さな画面で読みやすいか確認してから、広い画面の余白を整えると崩れにくそうです。",
  "機能を増やすだけでなく、使わないときに静かであることも品質の一部だと思います。",
  "初めて使う人が説明を読まなくても次の操作を選べるか、もう一度見直したいです。",
  "数字だけでは分からない使い心地を、実際の長さの文章とカードで確かめています。",
  "一度決めた仕様でも、使って違和感があれば理由を残して変更できるようにしたいです。",
  "公開情報と端末内だけの情報を混ぜず、保存場所が利用者に伝わる表現を優先します。",
  "一覧では比較しやすく、詳細では集中して読めるように役割を分けるのがよさそうです。",
  "読み込みに失敗したときも空白にせず、再試行や別の入口を提示できるようにします。",
  "色だけに頼らず、文字と形でも状態が分かるようにすると使いやすさが安定します。",
  "完成した画面だけでなく、判断の途中を共有できることがHubらしさにつながると思います。",
];

const snapshot = JSON.parse(readFileSync(dataPath, "utf8"));
const existingIds = new Set((snapshot.socialPosts ?? []).map((post) => post.id));
const generated = [];

for (let themeIndex = 0; themeIndex < themes.length; themeIndex += 1) {
  for (let angleIndex = 0; angleIndex < angles.length; angleIndex += 1) {
    const number = themeIndex * angles.length + angleIndex + 1;
    const id = `expanded-feed-${String(number).padStart(3, "0")}`;
    if (existingIds.has(id)) continue;
    const author = authors[(themeIndex + angleIndex) % authors.length];
    const [title, lead] = themes[themeIndex];
    generated.push({
      id,
      authorProfileId: author.id,
      displayName: author.displayName,
      handle: author.handle,
      identityMode: "account",
      body: `${title}について。${lead} ${angles[angleIndex]}`,
      createdAt: new Date(Date.UTC(2026, 6, 18, 6, number)).toISOString(),
      replyToPostId: null,
    });
  }
}

snapshot.socialPosts = [...generated.reverse(), ...(snapshot.socialPosts ?? [])];
writeFileSync(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const sql = ["PRAGMA foreign_keys = ON;"];
const escape = (value) => `'${String(value).replaceAll("'", "''")}'`;
for (const post of generated) {
  sql.push(`INSERT OR IGNORE INTO social_posts
    (id, author_profile_id, display_name, handle, identity_mode, body, created_at)
    VALUES (${[post.id, post.authorProfileId, post.displayName, post.handle, post.identityMode, post.body, post.createdAt].map(escape).join(", ")});`);
}
writeFileSync(sqlPath, `${sql.join("\n")}\n`);
console.log(`Generated ${generated.length} development feed posts.`);
