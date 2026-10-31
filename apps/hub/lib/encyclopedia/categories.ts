export interface EncyclopediaCategoryNode {
  id: string;
  name: string;
  description: string;
  parentId?: string;
  threadCategoryKey?: string;
  hidden?: boolean;
}

export const ENCYCLOPEDIA_CATEGORIES = [
  { id: "maintenance/uncategorized", name: "未分類", description: "分類候補の確認が必要な記事", hidden: true },
  { id: "technology", name: "IT・デジタル", description: "コンピューター、AI、通信とデジタル技術", threadCategoryKey: "cat03" },
  { id: "technology/ai", name: "AI・生成AI", description: "機械学習、生成AI、AI安全性", parentId: "technology" },
  { id: "technology/computing", name: "コンピューター・ソフトウェア", description: "計算機、OS、プログラミング、データ", parentId: "technology" },
  { id: "technology/internet-security", name: "インターネット・セキュリティ", description: "ウェブ、通信、クラウド、認証と暗号", parentId: "technology" },
  { id: "technology/robotics", name: "ロボット・デジタル基盤", description: "ロボット、半導体、制御、IoT", parentId: "technology" },

  { id: "knowledge", name: "学問・知識", description: "科学、数学、思想、言語と教育", threadCategoryKey: "cat04" },
  { id: "knowledge/mathematics", name: "数学・計算理論", description: "数学、統計、論理、計算理論", parentId: "knowledge" },
  { id: "knowledge/physical-sciences", name: "物理・化学・宇宙", description: "物理学、化学、天文学、宇宙科学", parentId: "knowledge" },
  { id: "knowledge/life-sciences", name: "生命科学", description: "生物学、遺伝学、神経科学", parentId: "knowledge" },
  { id: "knowledge/philosophy-language", name: "哲学・言語・宗教", description: "哲学、倫理、言語、宗教と思想", parentId: "knowledge" },
  { id: "knowledge/education", name: "教育・研究", description: "教育制度、学習、研究方法", parentId: "knowledge" },

  { id: "society", name: "社会・制度", description: "政治、法律、経済と公共課題", threadCategoryKey: "cat08" },
  { id: "society/politics-law", name: "政治・法律", description: "政治制度、行政、選挙、法律", parentId: "society" },
  { id: "society/economics-business", name: "経済・ビジネス", description: "経済、金融、企業、産業と労働", parentId: "society", threadCategoryKey: "cat09" },
  { id: "society/social-issues", name: "社会問題・人権", description: "格差、人権、メディア、公共課題", parentId: "society" },

  { id: "history", name: "歴史", description: "時代、事件、文明と人物", threadCategoryKey: "cat04" },
  { id: "history/world-history", name: "世界史・文明", description: "世界各地の時代、文明、戦争と交流", parentId: "history" },
  { id: "history/biography", name: "人物・伝記", description: "歴史上・現代の人物", parentId: "history" },

  { id: "culture", name: "文化・エンタメ", description: "映像、音楽、出版、芸術と大衆文化", threadCategoryKey: "cat02" },
  { id: "culture/film-tv", name: "映画・テレビ・配信", description: "映画、ドラマ、番組、映像作品", parentId: "culture" },
  { id: "culture/music", name: "音楽", description: "音楽家、作品、ジャンル、音楽産業", parentId: "culture" },
  { id: "culture/literature-comics", name: "文学・漫画・アニメ", description: "文学、書籍、漫画、アニメ", parentId: "culture" },
  { id: "culture/art-fashion", name: "芸術・デザイン・ファッション", description: "美術、建築、デザイン、服飾", parentId: "culture" },

  { id: "life", name: "暮らし・健康", description: "健康、医療、食、心理と生活", threadCategoryKey: "cat05" },
  { id: "life/medicine-health", name: "医学・健康", description: "病気、医療、身体、健康", parentId: "life" },
  { id: "life/psychology", name: "心理・こころ", description: "心理、意識、感情、メンタルヘルス", parentId: "life" },
  { id: "life/food", name: "食・料理", description: "食材、料理、飲料、食文化", parentId: "life", threadCategoryKey: "cat17" },

  { id: "nature", name: "自然・環境", description: "生物、地球、気候、環境とエネルギー", threadCategoryKey: "cat11" },
  { id: "nature/animals-plants", name: "動物・植物", description: "動物、植物、生態と進化", parentId: "nature" },
  { id: "nature/earth-environment", name: "地球・環境", description: "地球科学、生態系、災害、環境問題", parentId: "nature" },
  { id: "nature/climate-energy", name: "気候・エネルギー", description: "気候変動、資源、エネルギー、材料", parentId: "nature" },

  { id: "sports", name: "スポーツ", description: "競技、選手、チーム、大会とスポーツ文化", threadCategoryKey: "cat18" },
  { id: "sports/team", name: "球技・チーム競技", description: "サッカー、野球、バスケットボールなど", parentId: "sports" },
  { id: "sports/combat", name: "格闘技・武道", description: "ボクシング、格闘技、プロレス、武道", parentId: "sports" },
  { id: "sports/individual", name: "個人競技・大会", description: "陸上、水泳、テニス、五輪など", parentId: "sports" },
  { id: "sports/motorsport", name: "モータースポーツ", description: "自動車・二輪の競技", parentId: "sports" },

  { id: "games", name: "ゲーム", description: "ゲーム作品、企業、機器と競技文化", threadCategoryKey: "cat13" },
  { id: "games/video-games", name: "ビデオゲーム", description: "家庭用、PC、モバイル、オンラインゲーム", parentId: "games" },
  { id: "games/game-industry", name: "ゲーム産業・eスポーツ", description: "開発会社、流通、プラットフォーム、競技", parentId: "games" },

  { id: "world", name: "地域・世界", description: "国、都市、地域、地理と旅行", threadCategoryKey: "cat15" },
  { id: "world/countries-regions", name: "国・地域", description: "国家、地域、国際関係", parentId: "world" },
  { id: "world/cities", name: "都市", description: "都市の歴史、社会、文化とインフラ", parentId: "world" },
  { id: "world/geography-travel", name: "地理・場所", description: "地形、名所、建造物、移動", parentId: "world" },
] as const satisfies readonly EncyclopediaCategoryNode[];

export type EncyclopediaCategoryId = (typeof ENCYCLOPEDIA_CATEGORIES)[number]["id"];

const categoriesById = new Map<string, EncyclopediaCategoryNode>(
  ENCYCLOPEDIA_CATEGORIES.map((category) => [category.id, category]),
);

export const ENCYCLOPEDIA_ROOT_CATEGORIES = ENCYCLOPEDIA_CATEGORIES.filter((category) => !("parentId" in category) && !("hidden" in category && category.hidden));

export function getEncyclopediaCategoryNode(id: string) {
  return categoriesById.get(id);
}

export function getEncyclopediaCategoryChildren(parentId: string) {
  return ENCYCLOPEDIA_CATEGORIES.filter((category) => "parentId" in category && category.parentId === parentId);
}

export function getEncyclopediaCategoryPath(id: string) {
  const path: EncyclopediaCategoryNode[] = [];
  let current = categoriesById.get(id);
  while (current) {
    path.unshift(current);
    current = current.parentId ? categoriesById.get(current.parentId) : undefined;
  }
  return path;
}

export function isEncyclopediaCategoryOrDescendant(categoryId: string, ancestorId: string) {
  return getEncyclopediaCategoryPath(categoryId).some((category) => category.id === ancestorId);
}

interface CategorizedArticle {
  topicType: string;
  title: string;
  summary: string;
  description?: string;
  categoryLabel?: string;
}

function legacyTopicCategories(topicType: string, categoryLabel = "") {
  const value = `${topicType} ${categoryLabel}`;
  const categories = new Set<string>();
  if (/ai-core-part-[456]|機械学習|ニューラル|生成AI|AIシステム|AI安全|古典的機械学習|現代AI/.test(value)) categories.add("technology/ai");
  if (/ai-core-part-[123]|情報・データ|コンピューター|OS・ソフトウェア|プログラミング|アルゴリズム|計算理論|ソフトウェア運用|knowledge-language/.test(value)) categories.add("technology/computing");
  if (/ウェブ|認証|ネットワーク|セキュリティ|プライバシー|インターネット|クラウド|データベース/.test(value)) categories.add("technology/internet-security");
  if (/ai-core-part-[78]|ロボット|半導体|計算インフラ|ブロックチェーン|IoT|XR|視覚・音声・HCI/.test(value)) categories.add("technology/robotics");
  if (/数学|統計|最適化/.test(value)) categories.add("knowledge/mathematics");
  if (/宇宙|天文|物理|化学|physical-sciences/.test(value)) categories.add("knowledge/physical-sciences");
  if (/生命科学|バイオ|ゲノム|life-health/.test(value)) categories.add("knowledge/life-sciences");
  if (/哲学|倫理|認識論|社会・統治・哲学|philosophy-culture/.test(value)) categories.add("knowledge/philosophy-language");
  if (/医学|神経科学|老化|health/.test(value)) categories.add("life/medicine-health");
  if (/エネルギー|気候|材料/.test(value)) categories.add("nature/climate-energy");
  if (/politics-economics|economics|society/.test(value)) categories.add("society/politics-law");
  if (/history/.test(value)) categories.add("history/world-history");
  if (/culture/.test(value)) categories.add("culture/art-fashion");
  return categories;
}

const inferredCategoryRules: Array<[string, RegExp]> = [
  ["technology/ai", /人工知能|生成AI|機械学習|ニューラル|言語モデル|超知能|知能爆発|マインドアップローディング|サイボーグ|収穫加速|artificial intelligence|machine learning|neural|generative AI/i],
  ["technology/computing", /コンピュータ|ソフトウェア|プログラミング|アルゴリズム|データ|OS\b|計算機|計算手順|真空管|デジタルアーカイブ|技術製品・オンラインサービス|信号処理|オープン標準|時刻同期|computer|software|programming|algorithm|operating system/i],
  ["technology/internet-security", /インターネット|ウェブ|クラウド|サイバー|暗号|マルウェア|SNS|検索エンジン|ブロックチェーン|分散型|DNS|ドメイン名|証明書|公開鍵|internet|web |cloud|cyber|cryptograph|malware|social media|blockchain/i],
  ["technology/robotics", /ロボット|半導体|チップ|センサー|自動運転|robot|semiconductor|sensor|autonomous/i],
  ["knowledge/mathematics", /数学|統計|幾何|確率|論理学|指数関数|有限要素法|数値解析|mathematic|statistics|geometry|probability/i],
  ["knowledge/physical-sciences", /物理学|化学|宇宙|惑星|恒星|量子|天文学|physics|chemistry|space|planet|star|quantum|astronom/i],
  ["knowledge/life-sciences", /生物学|遺伝|細胞|進化|ゲノム|biology|genetic|cell|evolution|genome/i],
  ["knowledge/philosophy-language", /哲学|倫理|宗教|言語学|思想家|神話|仏教|キリスト教|イスラム教|ヒンドゥー教|神道|philosoph|ethic|religio|linguist/i],
  ["knowledge/education", /教育|学校|大学|学習|研究方法|education|school|university|learning/i],
  ["society/politics-law", /政治家|大統領|首相|王室|政府|議会|選挙|法律|裁判|特許|著作権|知的財産|規制|条約|ガバナンス|(?:の|る)権利|責任|同意|影響評価|politician|president|prime minister|government|parliament|election|law\b|court|patent|copyright|regulation|governance|liability|consent/i],
  ["society/economics-business", /企業|会社|産業|経済|金融|銀行|市場|ブランド|戦略|company|business|econom|finance|bank|market|brand/i],
  ["society/social-issues", /人権|差別|格差|労働|植民地|社会問題|存在リスク|ジャーナリズム|報道|公共圏|社会関係資本|human rights|discrimination|inequality|labor|colonial/i],
  ["history/world-history", /古代|中世|帝国|王朝|革命|戦争|文明|歴史|の乱|の変|武士|侍|忍者|芸者|ancient|medieval|empire|dynasty|revolution|war\b|civilization|history/i],
  ["history/biography", /人物|俳優|歌手|音楽家|作家|監督|選手|実業家|actor|actress|singer|musician|writer|director|athlete|entrepreneur/i],
  ["culture/film-tv", /映画|ドラマ|テレビ|俳優|監督|配信作品|film|movie|television|TV series|actor|actress|director/i],
  ["culture/music", /音楽|歌手|バンド|ラッパー|作曲|アルバム|K-POP|ヒップホップ|music|singer|band|rapper|composer|album/i],
  /* 天文学・水文学・人文学 は文学ではない。日本語に語境界は無いので、
     素の「文学」は天の川を文学・漫画・アニメへ入れていた。 */
  ["culture/literature-comics", /(?<![天水人])文学|小説|作家|漫画|アニメ|詩人|literature|novel|writer|manga|anime|poet/i],
  ["culture/art-fashion", /美術|芸術|建築|デザイン|ファッション|画家|文化形式・ジャンル・伝統|年中行事|七夕|祭り|art\b|artist|architecture|design|fashion|painter/i],
  ["life/medicine-health", /医学|医療|病気|疾患|健康|睡眠|脳|心臓|medical|medicine|disease|health|sleep|brain|heart/i],
  ["life/psychology", /心理|意識|感情|精神|psychology|consciousness|emotion|mental/i],
  ["life/food", /料理|食品|食文化|飲料|レストラン|food|cuisine|drink|restaurant/i],
  ["nature/animals-plants", /動物|植物|哺乳類|鳥類|魚類|恐竜|animal|plant|mammal|bird|fish|dinosaur/i],
  ["nature/earth-environment", /地球|環境|生態系|地震|火山|海洋|災害|earth|environment|ecosystem|earthquake|volcano|ocean|disaster/i],
  ["nature/climate-energy", /気候|エネルギー|電力|石油|原子力|再生可能|climate|energy|electricity|oil|nuclear|renewable/i],
  ["sports/team", /サッカー|野球|バスケット|ラグビー|クリケット|リーグ|球団|football|soccer|baseball|basketball|rugby|cricket|league|team/i],
  ["sports/combat", /ボクシング|格闘技|プロレス|柔道|空手|boxing|wrestling|martial arts|judo|karate/i],
  ["sports/individual", /オリンピック|テニス|ゴルフ|陸上|水泳|体操|Olympic|tennis|golf|athletics|swimming|gymnastics/i],
  ["sports/motorsport", /F1|モータースポーツ|レーシング|Formula One|motorsport|racing driver/i],
  ["games/video-games", /ゲーム|任天堂|PlayStation|Xbox|Steam|eスポーツ|video game|Nintendo|PlayStation|Xbox|Steam|esports/i],
  ["games/game-industry", /ゲーム会社|ゲーム機|ゲーム配信|ゲーム産業|game company|game console|game platform/i],
  ["world/countries-regions", /国家|共和国|王国|国土|国際関係|連邦|首長国|島国|位置する国|の国であ|の国または地域|country|republic|kingdom|nation-state/i],
  ["world/cities", /都市|首都|市街|大都市|city|capital city|metropolis/i],
  ["world/geography-travel", /山脈|河川|海峡|島|遺跡|宮殿|塔|大陸|観光|名所・遺産|砂漠|国立公園|熱帯雨林|mountain|river|strait|island|ruins|palace|tower|continent|tourism/i],
];

const definingCategoryRules: Array<[string, RegExp]> = [
  ["technology/ai", /人工知能|生成AI|機械学習|深層学習|ニューラルネットワーク|artificial intelligence|machine learning|deep learning/iu],
  ["technology/computing", /コンピューター|ソフトウェア|プログラミング|アルゴリズム|データベース|オペレーティングシステム|computer|software|programming|algorithm/iu],
  ["technology/internet-security", /ウェブ|ブラウザー|インターネット|サイバー|暗号|ネットワーク|web browser|internet|cyber|cryptograph/iu],
  ["knowledge/mathematics", /数学|統計学|確率|幾何学|mathematics|statistics|probability|geometry/iu],
  ["knowledge/physical-sciences", /天の川|宇宙|天文学|物理学|化学|惑星|恒星|銀河|astronomy|physics|chemistry|galaxy/iu],
  ["knowledge/life-sciences", /遺伝学|生物学|進化|細胞|ゲノム|genetics|biology|evolution|genome/iu],
  ["knowledge/philosophy-language", /哲学|倫理学|言語学|宗教|philosophy|ethics|linguistics|religion/iu],
  ["knowledge/education", /教育|学校|大学|学習|education|school|university/iu],
  ["society/politics-law", /自由主義|民主主義|政治|政府|選挙|法律|裁判|liberalism|democracy|politics|government|election|law/iu],
  ["society/economics-business", /経済|金融|企業|会社|産業|市場|economics|finance|company|business|industry/iu],
  ["history/world-history", /革命|文明|帝国|王朝|戦争|古代|中世|revolution|civilization|empire|dynasty|war/iu],
  ["history/biography", /人物|伝記|生涯|俳優|作家|詩人|歌手|選手|biography|actor|writer|poet|singer|athlete/iu],
  ["culture/film-tv", /映画|テレビ|ドラマ|映像作品|film|movie|television|TV series/iu],
  ["culture/music", /音楽|楽曲|アルバム|バンド|作曲家|music|album|band|composer/iu],
  ["culture/literature-comics", /(?<![天水人])文学|小説|詩|漫画|アニメ|戯曲|literature|novel|poetry|manga|anime|playwright/iu],
  ["culture/art-fashion", /美術|芸術|建築|デザイン|ファッション|博物館|美術館|art|architecture|design|museum/iu],
  ["life/medicine-health", /医学|医療|疾患|健康|病気|medicine|medical|disease|health/iu],
  ["life/psychology", /心理学|意識|感情|精神|psychology|consciousness|emotion/iu],
  ["life/food", /寿司|料理|食品|食文化|飲料|cuisine|food|drink/iu],
  ["nature/animals-plants", /動物|植物|哺乳類|鳥類|魚類|恐竜|ゾウ|animal|plant|mammal|bird|fish|dinosaur|elephant/iu],
  ["nature/earth-environment", /地球|環境|生態系|地震|火山|海洋|earth|environment|ecosystem|earthquake|volcano|ocean/iu],
  ["nature/climate-energy", /気候|エネルギー|電力|原子力|再生可能|climate|energy|electricity|nuclear|renewable/iu],
  ["games/video-games", /ゲーム|任天堂|PlayStation|Xbox|Steam|video game|Nintendo|esports/iu],
  ["world/countries-regions", /国家|共和国|王国|地域|country|republic|kingdom|region/iu],
  ["world/cities", /都市|首都|市区町村|city|capital|metropolis/iu],
  ["world/geography-travel", /山岳|河川|海峡|諸島|遺跡|宮殿|大陸|mountain|river|strait|island|ruins|continent/iu],
];

/* Collection labels describe how a batch was produced, not what an article
 * is about. Generation 5's「話題・人物・作品」contains 人物, which filed every
 * article in that batch — countries included — under history/biography. */
const NON_CLASSIFYING_LABELS = new Set(["話題・人物・作品"]);

/* Japanese biography leads open with the subject's defining occupation:
 * 「Xは、アメリカの俳優である」. Matching the occupation inside that clause
 * identifies people precisely — a passing mention elsewhere does not fire —
 * and names the domain facet the biography belongs to. */
const OCCUPATION_LEAD = /は、[^。]{0,50}?(俳優|女優|歌手|音楽家|作曲家|指揮者|バンド|ラッパー|作家|小説家|詩人|漫画家|映画監督|監督|選手|力士|棋士|政治家|大統領|首相|国王|女王|教皇|皇帝|実業家|起業家|経営者|投資家|科学者|物理学者|数学者|哲学者|発明家|研究者|軍人|探検家|建築家|画家|彫刻家|デザイナー|タレント|コメディアン|お笑い|モデル|アナウンサー|司会者|配信者|YouTuber|活動家|宗教家|僧|医師|弁護士)/u;

const OCCUPATION_LEAD_EN = /\b(?:is|was) an? [^.]{0,60}?\b(mathematician|computer scientist|scientist|physicist|chemist|biologist|philosopher|economist|historian|inventor|engineer|actor|actress|singer|musician|composer|rapper|writer|novelist|poet|director|athlete|footballer|politician|president|prime minister|entrepreneur|businessman|businesswoman|investor|artist|painter|architect|designer|comedian|model|activist)\b/i;

const OCCUPATION_DOMAIN: Array<[EncyclopediaCategoryId | string, RegExp]> = [
  ["culture/film-tv", /俳優|女優|映画監督|actor|actress|director/i],
  ["culture/music", /歌手|音楽家|作曲家|指揮者|バンド|ラッパー|singer|musician|composer|rapper/i],
  ["culture/literature-comics", /作家|小説家|詩人|漫画家|writer|novelist|poet/i],
  ["culture/art-fashion", /建築家|画家|彫刻家|デザイナー|artist|painter|architect|designer/i],
  ["society/politics-law", /政治家|大統領|首相|国王|女王|教皇|皇帝|活動家|弁護士|politician|president|prime minister|activist/i],
  ["society/economics-business", /実業家|起業家|経営者|投資家|entrepreneur|businessman|businesswoman|investor|economist/i],
  ["sports/team", /選手|athlete|footballer/i],
  ["sports/combat", /力士/u],
  ["knowledge/physical-sciences", /物理学者|physicist|chemist|scientist/i],
  ["knowledge/mathematics", /数学者|棋士|mathematician/i],
  ["technology/computing", /computer scientist/i],
  ["knowledge/philosophy-language", /哲学者|宗教家|僧|philosopher/i],
  ["knowledge/life-sciences", /biologist/i],
  ["history/world-history", /historian/i],
  ["life/medicine-health", /医師/u],
];

/* A katakana middle-dot name (ドナルド・トランプ) is a person even when the
 * summary uses an occupation word this table does not know. */
const KATAKANA_PERSON_NAME = /^[\p{Script=Katakana}ー]+(?:[・=][\p{Script=Katakana}ー]+)+$/u;

export function getArticleCategoryIds(article: CategorizedArticle): EncyclopediaCategoryId[] {
  const scores = new Map<string, number>();
  const record = (id: string, score: number) => scores.set(id, Math.max(scores.get(id) ?? 0, score));
  const categoryLabel = NON_CLASSIFYING_LABELS.has(article.categoryLabel ?? "") ? "" : article.categoryLabel;
  for (const id of legacyTopicCategories(article.topicType, categoryLabel)) record(id, 90);
  const definingText = `${article.title} ${article.topicType} ${categoryLabel ?? ""}`;
  for (const [categoryId, pattern] of definingCategoryRules) if (pattern.test(definingText)) record(categoryId, 105);
  const leadOccupation = OCCUPATION_LEAD.exec(article.summary) ?? OCCUPATION_LEAD_EN.exec(article.summary);
  if (leadOccupation) {
    record("history/biography", 100);
    for (const [categoryId, pattern] of OCCUPATION_DOMAIN) if (pattern.test(leadOccupation[1])) record(categoryId, 100);
  } else if (KATAKANA_PERSON_NAME.test(article.title.normalize("NFKC").trim())) {
    record("history/biography", 92);
  }
  /* The first sentence of an encyclopedia summary is the definition — a
   * genus named there classifies the article, unlike a passing mention
   * further in, which stays at informative weight only. */
  const firstSentence = article.summary.split("。")[0] ?? "";
  const fields = [
    { value: article.title, weight: 110 },
    { value: `${article.topicType} ${categoryLabel ?? ""}`, weight: 95 },
    { value: firstSentence, weight: 90 },
    { value: article.summary, weight: 60 },
    { value: article.description ?? "", weight: 35 },
  ];
  for (const [categoryId, pattern] of inferredCategoryRules) {
    for (const field of fields) if (pattern.test(field.value)) record(categoryId, field.weight);
  }
  const ranked = [...scores]
    .filter(([id]) => categoriesById.has(id))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"));
  if (!ranked.length) return ["maintenance/uncategorized"];
  // Wikipedia-style categories describe defining characteristics. A passing
  // mention in the summary or body can inform tags, but must not classify the article.
  const selected = ranked.filter(([, score]) => score >= 90).map(([id]) => id);
  if (!selected.length && ranked[0]?.[1] >= 60) selected.push(ranked[0][0]);
  if (!selected.length) return ["maintenance/uncategorized"];
  return selected
    .filter((id) => !selected.some((candidate) => candidate !== id && isEncyclopediaCategoryOrDescendant(candidate, id)))
    .slice(0, 4) as EncyclopediaCategoryId[];
}

export function articleMatchesEncyclopediaCategory(article: CategorizedArticle, selectedCategoryId: string) {
  return getArticleCategoryIds(article).some((categoryId) => isEncyclopediaCategoryOrDescendant(categoryId, selectedCategoryId));
}

export function getPrimaryArticleCategory(article: CategorizedArticle) {
  return getEncyclopediaCategoryNode(getArticleCategoryIds(article)[0]) ?? ENCYCLOPEDIA_ROOT_CATEGORIES[0];
}

// Compatibility for existing callers that only have a topic type.
export function getEncyclopediaCategory(topicType: string) {
  const categoryId = getArticleCategoryIds({ topicType, title: "", summary: "" })[0];
  return getEncyclopediaCategoryPath(categoryId)[0]?.id ?? "society";
}

export const ENCYCLOPEDIA_CATEGORY_NAMES = Object.fromEntries(
  ENCYCLOPEDIA_ROOT_CATEGORIES.map((category) => [category.id, category.name]),
) as Record<string, string>;

export const ENCYCLOPEDIA_CATEGORY_ORDER = ENCYCLOPEDIA_ROOT_CATEGORIES.map((category) => category.id);
