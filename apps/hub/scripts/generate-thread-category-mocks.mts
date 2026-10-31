import { BBS_CATEGORIES, buildBoardCatalog } from "../lib/bbs-board-catalog";

const hex = (value: string) => Buffer.from(value, "utf8").toString("hex").toUpperCase();
const text = (value: string) => `CAST(X'${hex(value)}' AS TEXT)`;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const boards = buildBoardCatalog();
const categoryByBoard = new Map(
  BBS_CATEGORIES.flatMap((category) =>
    category.boards.map((_, index) => [
      `${category.key}-board${String(index + 1).padStart(2, "0")}`,
      category,
    ] as const),
  ),
);

const titlePatterns = [
  "初心者が最初に知っておきたいこと",
  "実際に役立った方法を共有するスレッド",
  "よくある失敗と避けるための工夫",
  "世界各地での違いを比べてみよう",
  "最近変わった情報と確認できる出典",
];
const openingPatterns = [
  "初めて調べる人にも分かるよう、具体例と注意点を集めたいです。",
  "実際に試した条件、結果、うまくいかなかった点も含めて共有してください。",
  "地域や言語によって事情が異なる場合は、対象地域も添えてください。",
  "一次情報や参考資料がある場合は出典を添え、古い情報は訂正してください。",
  "複数の立場から利点と問題点を整理し、今後も更新できる情報にしましょう。",
];
const replyPatterns = [
  "私の経験では、小さく試して結果を記録する方法が役立ちました。条件が違えば結果も変わる点には注意が必要です。",
  "別の見方もあります。便利さだけでなく、費用、時間、安全性を分けて比べると判断しやすくなります。",
  "補足します。初心者向けには、最初の一歩と失敗したときの戻し方をセットで説明すると分かりやすいです。",
  "訂正です。以前の情報から状況が変わっている可能性があります。最新の日付と公式情報を確認してください。",
  "ここまでの回答をまとめると、目的を決める、条件を確認する、小さく試す、結果を見直す、の順が良さそうです。",
];

const boardRows = boards.map((board) =>
  `(${quote(board.id)},${quote(board.key)},${text(board.title)},${quote(board.slug)},${text(board.description)},'2026-07-24T00:00:00.000Z','2026-07-24T00:00:00.000Z')`,
);
const threadRows: string[] = [];
const postRows: string[] = [];
const qualityRows: string[] = [];
const summaryRows: string[] = [];
let sequence = 0;

for (const board of boards) {
  const category = categoryByBoard.get(board.key);
  if (!category) continue;
  for (let index = 1; index <= 5; index += 1) {
    sequence += 1;
    const suffix = String(index).padStart(2, "0");
    const threadId = `category-mock-${board.key}-${suffix}`;
    const type = (["question", "information", "recruitment", "chat", "question"] as const)[index - 1];
    const createdAt = new Date(Date.UTC(2026, 6, 1 + (sequence % 22), sequence % 24, (sequence * 7) % 60)).toISOString();
    const updatedAt = new Date(Date.UTC(2026, 6, 24, sequence % 20, (sequence * 11) % 60)).toISOString();
    const title = `${board.title}：${titlePatterns[index - 1]}`;
    const opening = `${category.name}の「${board.title}」についてのスレッドです。${board.description} ${openingPatterns[index - 1]}`;
    const profile = (["profile-noa", "profile-rin", "profile-yoru", "profile-me"] as const)[sequence % 4];
    const display = profile === "profile-noa" ? "Noa" : profile === "profile-rin" ? "Rin" : profile === "profile-yoru" ? "Yoru" : "J Kamma";
    threadRows.push(`(${quote(threadId)},${quote(board.id)},${quote(profile)},${text(title)},'ja',${quote(sequence % 5 === 0 ? "global" : sequence % 4 === 0 ? "europe" : sequence % 3 === 0 ? "asia-pacific" : "local")},0,${quote(createdAt)},${quote(updatedAt)},${quote(type)},${text(JSON.stringify([category.name, board.title]))},'open','active')`);
    postRows.push(`(${quote(`${threadId}-p01`)},${quote(threadId)},1,${quote(profile)},${text(display)},${text(opening)},NULL,${quote(createdAt)},0)`);
    const replyCount = 2 + (sequence % 4);
    for (let reply = 2; reply <= replyCount; reply += 1) {
      const anonymous = (sequence + reply) % 7 === 0;
      const replyProfile = (["profile-rin", "profile-yoru", "profile-me", "profile-noa"] as const)[(sequence + reply) % 4];
      const replyDisplay = anonymous ? `匿名 ${reply}` : replyProfile === "profile-noa" ? "Noa" : replyProfile === "profile-rin" ? "Rin" : replyProfile === "profile-yoru" ? "Yoru" : "J Kamma";
      const body = `${board.title}について、${replyPatterns[(reply - 2) % replyPatterns.length]}`;
      const replyTo = reply >= 4 ? `${threadId}-p${String(reply - 2).padStart(2, "0")}` : `${threadId}-p01`;
      postRows.push(`(${quote(`${threadId}-p${String(reply).padStart(2, "0")}`)},${quote(threadId)},${reply},${anonymous ? "NULL" : quote(replyProfile)},${text(replyDisplay)},${text(body)},${quote(replyTo)},${quote(updatedAt)},${anonymous ? 1 : 0})`);
    }
    qualityRows.push(`(${quote(`${threadId}-p02`)},${quote(profile === "profile-noa" ? "profile-rin" : "profile-noa")},'helpful',1,${quote(updatedAt)},${quote(updatedAt)})`);
    if (index === 5) {
      summaryRows.push(`(${quote(`${threadId}-summary`)},${quote(threadId)},1,${text(`${board.title}について、初心者向けの手順、異なる見方、注意点、最新情報の確認方法を整理した共同まとめです。`)},'community','published','profile-noa','profile-yoru',${quote(updatedAt)},${quote(updatedAt)})`);
    }
  }
}

const batchedInsert = (prefix: string, rows: string[], suffix = ";", size = 100) => {
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += size) {
    statements.push(`${prefix}\n${rows.slice(start, start + size).join(",\n")}\n${suffix}`);
  }
  return statements.join("\n\n");
};

const sql = `-- Generated development-only category-specific mock content.
${batchedInsert(
  "INSERT INTO boards(id,board_key,title,slug,description,created_at,updated_at) VALUES",
  boardRows,
  "ON CONFLICT(board_key) DO UPDATE SET title=excluded.title,slug=excluded.slug,description=excluded.description,updated_at=excluded.updated_at;",
  50,
)}

${batchedInsert(
  "INSERT INTO threads(id,board_id,created_by_profile_id,title,language,region,pinned,created_at,updated_at,thread_type,tags_json,status,moderation_status) VALUES",
  threadRows,
  "ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id,title=excluded.title,language=excluded.language,region=excluded.region,thread_type=excluded.thread_type,tags_json=excluded.tags_json,status=excluded.status,moderation_status=excluded.moderation_status;",
)}

${batchedInsert(
  "INSERT INTO thread_posts(id,thread_id,post_no,author_profile_id,display_name,body,reply_to_post_id,created_at,is_anonymous) VALUES",
  postRows,
  "ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,body=excluded.body,reply_to_post_id=excluded.reply_to_post_id,is_anonymous=excluded.is_anonymous;",
)}

UPDATE threads
SET best_answer_post_id=id || '-p02', solved_at=updated_at, status='closed'
WHERE id LIKE 'category-mock-%' AND thread_type='question';

${batchedInsert(
  "INSERT OR IGNORE INTO thread_post_quality_votes(post_id,profile_id,dimension,value,created_at,updated_at) VALUES",
  qualityRows,
)}

${batchedInsert(
  "INSERT OR IGNORE INTO thread_summary_revisions(id,thread_id,revision_no,body,source,status,created_by_profile_id,reviewed_by_profile_id,created_at,reviewed_at) VALUES",
  summaryRows,
)}
`;

process.stdout.write(sql);
