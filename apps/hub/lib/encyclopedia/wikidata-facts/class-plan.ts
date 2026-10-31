import type { Fact } from "./facts";

/*
 * Per-class article plans for Wikidata fact stubs (owner decision 2026-10-30, readability pass). Each main P31 class gets
 * (a) property labels that read correctly in that context (a film's P577 is 公開日, a book's is 刊行日), (b) a fixed
 * section plan that assigns every kept property to a section with a descriptive heading, so the model receives facts
 * already grouped and must keep them there, and (c) a list of properties that read badly or are noise and are omitted.
 * Pure functions; the same code serves a freshly built fact list and facts read back from a stored trial.
 */

export type ClassKey = "film" | "conflict" | "earthquake" | "protected" | "natural" | "institution" | "building" | "organisation" | "artwork" | "settlement" | "human" | "book" | "album" | "generic";

type SectionDef = { heading: string | null; pids: readonly string[] };
type ClassDef = {
  key: ClassKey;
  title: string;
  /** Wikidata classes (P31 values) that select this plan; the order of CLASSES is the precedence. */
  p31: readonly string[];
  labels: Readonly<Record<string, string>>;
  sections: readonly SectionDef[];
};

/** Properties that are noise in every class: media, rating boards, social counts, contact data, bookkeeping. */
export const GLOBAL_OMIT: ReadonlySet<string> = new Set([
  "P935", "P1612", "P1814", "P1705", "P163", "P237", "P2572", "P8687", "P1329", "P2900", "P2848", "P1830", "P1981", "P2747", "P5970", "P2363", "P2684", "P2758", "P3650",
  "P3306", "P3402", "P444", "P437", "P5021", "P1476", "P1383", "P2936", "P1840", "P6104", "P837", "P2139", "P8093", "P6125", "P2817", "P1810", "P3259", "P463",
]);

/** Labels that read the same way in every class; a class may override them. */
const COMMON_LABELS: Readonly<Record<string, string>> = {
  P31: "分類", P17: "国", P131: "所在する行政区画", P625: "位置座標", P138: "名称の由来", P571: "成立日", P576: "廃止日",
  P47: "隣接する地域", P361: "一部をなす対象", P527: "含む対象", P1435: "指定", P2614: "世界遺産の登録基準",
};

/** Properties whose value is rendered as a phrase, not a bare name: P138 "named after" reads 「〜にちなむ」. */
const VALUE_SUFFIX: Readonly<Record<string, string>> = { P138: "にちなむ" };

const FILM_LABELS: Record<string, string> = {
  P577: "公開日", P161: "出演", P57: "監督", P58: "脚本", P162: "製作", P272: "制作会社", P364: "原語", P495: "製作国", P915: "撮影地", P750: "配給元", P840: "物語の舞台",
  P921: "主題", P2047: "上映時間", P462: "映像の色", P2061: "アスペクト比", P144: "元になった作品", P1877: "原作者", P179: "シリーズ", P86: "音楽", P344: "撮影",
  P1040: "編集", P166: "受賞", P1411: "ノミネート", P136: "ジャンル", P2554: "美術", P725: "声の出演", P175: "出演", P156: "続編", P2130: "製作費", P2142: "興行収入", P2348: "時代設定",
};

const PLACE_LABELS: Record<string, string> = {
  P1082: "人口", P6343: "都市部の人口", P6344: "農村部の人口", P1539: "女性の人口", P1540: "男性の人口", P1538: "世帯数", P1831: "有権者数", P1081: "人間開発指数",
  P1376: "首都となっている行政区画", P6: "首長", P1313: "首長の役職", P194: "議決機関", P150: "下位の行政区画", P37: "公用語", P190: "姉妹都市", P281: "郵便番号",
  P473: "市外局番", P395: "ナンバープレートの記号", P2044: "標高", P2046: "面積", P206: "接する水域", P30: "大陸", P1249: "文献での初出年", P793: "重要な出来事",
  P417: "守護聖人", P706: "位置する地形", P797: "権限を持つ機関", P7153: "主な場所",
};

const CONFLICT_LABELS: Record<string, string> = {
  P710: "参加者", P276: "場所", P580: "開始", P582: "終了", P585: "発生日", P361: "一部をなす事象", P527: "含まれる事象", P1542: "結果として生じたもの", P828: "原因",
  P1478: "直接の原因", P1479: "寄与した要因", P155: "前の事象", P156: "次の事象", P1120: "死者数", P1339: "負傷者数", P5630: "捕虜の数", P3082: "全壊した建物の数", P4791: "指揮官",
  P1366: "後続", P706: "位置する地形", P625: "位置座標",
};

const NATURAL_LABELS: Record<string, string> = {
  P2044: "標高", P2043: "全長", P2049: "全幅", P2046: "面積", P4511: "最大深度", P2234: "体積", P2547: "外周", P610: "最高地点", P4552: "属する山脈", P706: "位置する地形",
  P4777: "境界を接する対象", P200: "流入する河川", P201: "流出先", P205: "流域国", P206: "接する水域", P2053: "流域面積", P3020: "滞留時間", P4614: "分水嶺", P3018: "位置する保護区",
  P814: "IUCN保護区カテゴリ", P5816: "保全状態", P30: "大陸", P7153: "主な場所", P2348: "地質年代", P4688: "地形区分",
};

const PROTECTED_LABELS: Record<string, string> = {
  P2046: "面積", P2044: "標高", P610: "最高地点", P4552: "属する山脈", P706: "位置する地形", P7153: "主な場所", P814: "IUCN保護区カテゴリ", P137: "運営者", P126: "管理者", P127: "所有者",
  P797: "権限を持つ機関", P92: "設立の法的根拠", P1174: "年間訪問者数", P2872: "ビジターセンター", P3018: "位置する保護区", P571: "設立日", P580: "開始",
};

const INSTITUTION_LABELS: Record<string, string> = {
  P571: "設立日", P1619: "開館日", P84: "設計者", P149: "建築様式", P669: "所在地の通り", P159: "本部所在地", P281: "郵便番号", P2046: "面積", P1435: "指定", P825: "献呈先", P88: "発注者",
  P127: "所有者", P137: "運営者", P1037: "館長・代表者", P112: "創設者", P121: "運用する施設", P1128: "従業員数", P1454: "組織形態", P912: "保有する施設", P1436: "収蔵数", P1174: "年間訪問者数",
  P2555: "料金", P276: "場所", P921: "主題", P140: "宗教", P1552: "特徴",
};

const BUILDING_LABELS: Record<string, string> = {
  P571: "建設・成立日", P1619: "開始日", P84: "設計者", P149: "建築様式", P127: "所有者", P88: "発注者", P186: "材料", P366: "用途", P466: "利用者", P5816: "保全状態", P112: "創設者",
  P669: "所在地の通り", P276: "場所", P706: "位置する地形", P2044: "標高", P2046: "面積", P2048: "高さ", P135: "建築運動", P195: "所蔵者", P170: "作者", P793: "重要な出来事", P2348: "時代",
  P180: "題材", P2670: "含む部分のクラス", P281: "郵便番号", P1552: "特徴", P3018: "位置する保護区",
};

const SETTLEMENT_SECTIONS: readonly SectionDef[] = [
  { heading: null, pids: ["description", "P31", "P17", "P131", "P1376", "P571"] },
  { heading: "地理", pids: ["P625", "P2044", "P2046", "P47", "P206", "P706", "P30", "P7153", "P361", "P527", "P1383"] },
  { heading: "人口", pids: ["P1082", "P6343", "P6344", "P1539", "P1540", "P1538", "P1831", "P1081"] },
  { heading: "行政", pids: ["P6", "P1313", "P194", "P150", "P797", "P37", "P281", "P473", "P395"] },
  { heading: "姉妹都市", pids: ["P190"] },
  { heading: "歴史と文化", pids: ["P1249", "P793", "P138", "P1435", "P417", "P2348"] },
];

const CLASSES: readonly ClassDef[] = [
  {
    key: "film", title: "映画", p31: ["Q11424"], labels: FILM_LABELS,
    sections: [
      { heading: null, pids: ["description", "P31", "P495", "P577", "P57", "P136"] },
      { heading: "制作", pids: ["P58", "P162", "P272", "P86", "P344", "P1040", "P2554", "P915", "P364", "P462", "P2061", "P2047", "P2130", "P750", "P179", "P156", "P144", "P1877", "P2142"] },
      { heading: "出演", pids: ["P161", "P175", "P725"] },
      { heading: "内容", pids: ["P840", "P2348", "P921", "P138"] },
      { heading: "受賞とノミネート", pids: ["P166", "P1411"] },
    ],
  },
  {
    key: "conflict", title: "戦争・戦闘・軍事行動", p31: ["Q178561", "Q198", "Q645883", "Q350604", "Q188055", "Q1361229"], labels: CONFLICT_LABELS,
    sections: [
      { heading: null, pids: ["description", "P31", "P138"] },
      { heading: "時期と場所", pids: ["P580", "P582", "P585", "P276", "P17", "P131", "P706", "P625"] },
      { heading: "参加者", pids: ["P710", "P4791"] },
      { heading: "背景と位置づけ", pids: ["P828", "P1478", "P1479", "P361", "P527", "P155", "P156", "P1542", "P1366", "P2348"] },
      { heading: "被害", pids: ["P1120", "P1339", "P5630", "P3082"] },
    ],
  },
  {
    key: "earthquake", title: "地震", p31: ["Q7944"], labels: { ...CONFLICT_LABELS, P2527: "モーメントマグニチュード", P2528: "リヒターマグニチュード", P2784: "メルカリ震度階級", P4511: "震源の深さ" },
    sections: [
      { heading: null, pids: ["description", "P31", "P17", "P585", "P131", "P276"] },
      { heading: "震源と規模", pids: ["P625", "P2527", "P2528", "P2784", "P4511", "P2047"] },
      { heading: "被害", pids: ["P1120", "P1339", "P3082"] },
    ],
  },
  {
    key: "protected", title: "国立公園・保護地域", p31: ["Q46169", "Q473972", "Q15069452", "Q158454", "Q22698", "Q1316973"], labels: PROTECTED_LABELS,
    sections: [
      { heading: null, pids: ["description", "P31", "P17", "P131", "P571"] },
      { heading: "地理", pids: ["P625", "P2046", "P2044", "P610", "P4552", "P706", "P7153", "P47", "P361", "P527", "P3018", "P200", "P206"] },
      { heading: "指定と管理", pids: ["P814", "P1435", "P2614", "P137", "P126", "P127", "P797", "P92", "P793", "P580"] },
      { heading: "利用", pids: ["P1174", "P2872"] },
    ],
  },
  {
    key: "natural", title: "山地・湖・河川", p31: ["Q46831", "Q674541", "Q23397"], labels: NATURAL_LABELS,
    sections: [
      { heading: null, pids: ["description", "P31", "P17", "P131"] },
      { heading: "地理", pids: ["P625", "P30", "P2044", "P2046", "P2043", "P2049", "P4511", "P2234", "P2547", "P610", "P4552", "P706", "P4777", "P47", "P361", "P527", "P7153", "P4688", "P2348"] },
      { heading: "水系", pids: ["P200", "P201", "P205", "P206", "P2053", "P3020", "P4614"] },
      { heading: "保護と指定", pids: ["P1435", "P3018", "P814", "P5816", "P2614"] },
    ],
  },
  {
    key: "institution", title: "博物館・図書館", p31: ["Q33506", "Q7075", "Q22806", "Q17431399", "Q207694", "Q124830411"], labels: INSTITUTION_LABELS,
    sections: [
      { heading: null, pids: ["description", "P31", "P17", "P131", "P571", "P1619"] },
      { heading: "所在地と建物", pids: ["P625", "P669", "P281", "P276", "P84", "P149", "P88", "P825", "P2046", "P1435", "P361", "P527"] },
      { heading: "運営", pids: ["P127", "P137", "P1037", "P112", "P121", "P1128", "P159", "P1454", "P912"] },
      { heading: "収蔵と利用", pids: ["P1436", "P1174", "P2555", "P921", "P140"] },
    ],
  },
  {
    key: "building", title: "城・宮殿・建造物・遺跡", p31: ["Q23413", "Q16560", "Q751876", "Q2319498", "Q839954", "Q1497375", "Q2065736"], labels: BUILDING_LABELS,
    sections: [
      { heading: null, pids: ["description", "P31", "P17", "P131", "P571"] },
      { heading: "所在地", pids: ["P625", "P669", "P276", "P706", "P2044", "P2046", "P2048", "P281", "P361", "P527"] },
      { heading: "建築と用途", pids: ["P84", "P149", "P186", "P366", "P88", "P135", "P2670"] },
      { heading: "歴史", pids: ["P112", "P127", "P466", "P793", "P195", "P2348", "P138"] },
      { heading: "指定と保存", pids: ["P1435", "P2614", "P5816", "P3018"] },
    ],
  },
  {
    key: "organisation", title: "組織", p31: ["Q163740", "Q43229", "Q4830453", "Q783794"], labels: { P159: "本部所在地", P112: "創設者", P1037: "代表者", P1128: "従業員数", P127: "所有者", P749: "親組織", P571: "設立日", P576: "解散日", P101: "活動分野", P1454: "組織形態" },
    sections: [
      { heading: null, pids: ["description", "P31", "P17", "P131", "P571", "P576"] },
      { heading: "運営", pids: ["P112", "P1037", "P159", "P1128", "P127", "P749", "P1454"] },
      { heading: "活動", pids: ["P101", "P361", "P527", "P166"] },
    ],
  },
  {
    key: "artwork", title: "彫刻・美術作品", p31: ["Q179700", "Q860861", "Q3305213"], labels: { P170: "作者", P186: "材料", P2048: "高さ", P2049: "幅", P2046: "面積", P2043: "全長", P195: "所蔵者", P127: "所有者", P276: "場所", P571: "制作年" },
    sections: [
      { heading: null, pids: ["description", "P31", "P170", "P571", "P17"] },
      { heading: "素材と寸法", pids: ["P186", "P2048", "P2049", "P2046", "P2043"] },
      { heading: "所在", pids: ["P276", "P625", "P131", "P127", "P195", "P1435"] },
    ],
  },
  {
    key: "human", title: "人物", p31: ["Q5"], labels: { P27: "国籍", P106: "職業", P569: "生年月日", P570: "没年月日", P19: "出生地", P20: "死没地", P69: "出身校", P108: "勤務先", P39: "就いた役職", P54: "所属チーム", P641: "競技", P800: "代表作", P166: "受賞", P1411: "ノミネート", P1344: "参加した事象", P136: "ジャンル", P1303: "演奏楽器" },
    sections: [
      { heading: null, pids: ["description", "P31", "P27", "P106", "P569", "P19", "P570", "P20"] },
      { heading: "経歴", pids: ["P69", "P108", "P39", "P54", "P641", "P1344"] },
      { heading: "活動", pids: ["P800", "P136", "P1303"] },
      { heading: "受賞", pids: ["P166", "P1411"] },
    ],
  },
  {
    key: "book", title: "書籍", p31: ["Q7725634", "Q571", "Q8261", "Q1004"], labels: { P50: "著者", P577: "刊行日", P407: "言語", P123: "出版社", P495: "原産国", P921: "主題", P840: "物語の舞台", P144: "元になった作品", P629: "原典", P179: "シリーズ", P136: "ジャンル", P166: "受賞" },
    sections: [
      { heading: null, pids: ["description", "P31", "P50", "P577", "P407", "P495"] },
      { heading: "刊行", pids: ["P123", "P629", "P179", "P144"] },
      { heading: "内容", pids: ["P136", "P921", "P840"] },
      { heading: "受賞", pids: ["P166"] },
    ],
  },
  {
    key: "album", title: "音楽作品", p31: ["Q482994", "Q134556", "Q7366"], labels: { P175: "演奏者", P577: "発売日", P136: "ジャンル", P162: "プロデューサー", P264: "レーベル", P2047: "収録時間", P166: "受賞" },
    sections: [
      { heading: null, pids: ["description", "P31", "P175", "P577", "P136", "P495"] },
      { heading: "制作", pids: ["P162", "P264", "P2047", "P86"] },
      { heading: "受賞", pids: ["P166"] },
    ],
  },
  {
    key: "settlement", title: "都市・町・自治体", labels: PLACE_LABELS, sections: SETTLEMENT_SECTIONS,
    p31: [
      "Q515", "Q1549591", "Q3184121", "Q3957", "Q42744322", "Q486972", "Q56557504", "Q7930989", "Q902814", "Q15284", "Q3491088", "Q2616791", "Q13539802", "Q1852859", "Q12131624",
      "Q134626", "Q56061", "Q1963041", "Q12813115", "Q18918041", "Q707813", "Q116621859", "Q15141632", "Q54935786", "Q2039348", "Q3505887", "Q532", "Q484170", "Q702492", "Q747074",
    ],
  },
];

const GENERIC: ClassDef = {
  key: "generic", title: "その他", p31: [], labels: PLACE_LABELS,
  sections: [
    { heading: null, pids: ["description", "P31", "P17", "P131", "P571", "P576"] },
    { heading: "地理", pids: ["P625", "P2044", "P2046", "P47", "P361", "P527"] },
  ],
};

export function classKeyOf(p31: readonly string[] | undefined): ClassKey {
  const set = new Set(p31 ?? []);
  for (const def of CLASSES) if (def.p31.some((qid) => set.has(qid))) return def.key;
  return "generic";
}

const defOf = (key: ClassKey): ClassDef => CLASSES.find((def) => def.key === key) ?? GENERIC;

/** Headings the model may use for this class, in plan order. */
export function planHeadings(key: ClassKey): string[] {
  return defOf(key).sections.map((section) => section.heading).filter((heading): heading is string => heading !== null);
}

export function classTitle(key: ClassKey): string {
  return defOf(key).title;
}

export type FactGroup = { heading: string | null; factIds: string[] };
export type PlannedFacts = { classKey: ClassKey; facts: Fact[]; groups: FactGroup[]; omitted: number };

/** Re-renders a fact line with the class's property label (and the 「〜にちなむ」 phrasing of P138). */
function relabel(fact: Fact, labels: Readonly<Record<string, string>>): Fact {
  if (fact.pid === "description") return fact;
  const property = labels[fact.pid] ?? COMMON_LABELS[fact.pid] ?? fact.property;
  const suffix = VALUE_SUFFIX[fact.pid] ?? "";
  const value = suffix && !fact.value.endsWith(suffix) ? `${fact.value}${suffix}` : fact.value;
  const text = `${property}: ${value}${fact.qualifiers.length ? `（${fact.qualifiers.join("、")}）` : ""}`;
  return { ...fact, property, value, text };
}

/**
 * Assigns every fact of an item to its class section. A fact whose property is not in the plan, or is on the omit list, is
 * left out. Fact ids are kept (the model cites them), and facts inside a section follow the plan's property order.
 */
export function planFacts(facts: readonly Fact[], key: ClassKey): PlannedFacts {
  const def = defOf(key);
  const groups: FactGroup[] = def.sections.map((section) => ({ heading: section.heading, factIds: [] }));
  const kept: Fact[] = [];
  let omitted = 0;
  const sectionIndexOf = new Map<string, number>();
  def.sections.forEach((section, index) => { for (const pid of section.pids) if (!sectionIndexOf.has(pid)) sectionIndexOf.set(pid, index); });
  const placed: Array<{ fact: Fact; section: number; order: number }> = [];
  for (const fact of facts) {
    const section = sectionIndexOf.get(fact.pid);
    if (section === undefined || GLOBAL_OMIT.has(fact.pid)) { omitted += 1; continue; }
    const order = def.sections[section].pids.indexOf(fact.pid);
    placed.push({ fact: { ...relabel(fact, def.labels), section: def.sections[section].heading }, section, order });
  }
  placed.sort((a, b) => a.section - b.section || a.order - b.order || Number(a.fact.id.slice(1)) - Number(b.fact.id.slice(1)));
  for (const entry of placed) { groups[entry.section].factIds.push(entry.fact.id); kept.push(entry.fact); }
  return { classKey: key, facts: kept, groups: groups.filter((group) => group.factIds.length > 0), omitted };
}
