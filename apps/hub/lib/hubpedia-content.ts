export interface HubpediaCategory {
  name: string;
  description: string;
}

export interface HubpediaArticle {
  slug: string;
  title: string;
  category: string;
  summary: string;
  popularRank?: number;
  latestRank?: number;
  reading?: string;
  aliases?: readonly string[];
  body?: string;
  reviewStatus?: "completed" | "review-required" | "sources-required" | "planning-required";
}

export const HUBPEDIA_CATEGORIES: HubpediaCategory[] = [
  { name: "科学・自然", description: "宇宙、生き物、環境、生命科学" },
  { name: "技術・ものづくり", description: "AI、ソフトウェア、発明、道具" },
  { name: "暮らし・文化", description: "食、健康、言葉、芸術、地域" },
  { name: "歴史・学び", description: "世界史、人物、教育、知識" }
];

export const HUBPEDIA_ARTICLES: HubpediaArticle[] = [
  { slug: "healthy-life-expectancy", title: "健康寿命", reading: "けんこうじゅみょう", category: "生命科学", summary: "健康に生活できる期間を測るための指標と研究。", body: "健康寿命は、日常生活に大きな制限なく生活できる期間を示します。平均寿命との差を小さくするため、運動、食事、睡眠、社会参加など幅広い観点から研究されています。" },
  { slug: "generative-ai", title: "生成AI", reading: "せいせいai せいせいえーあい", category: "技術", summary: "文章や画像を生成する人工知能の仕組みと活用。", body: "生成AIは、学習したデータのパターンをもとに新しい文章、画像、音声などを作る技術です。創作や調査を支援しますが、情報の正確性や著作権、プライバシーへの配慮も必要です。" },
  { slug: "fermentation", title: "発酵", reading: "はっこう", category: "食・科学", summary: "微生物の働きを利用して食品などを作る仕組み。", body: "発酵は、微生物が物質を分解・変化させ、人にとって有用な成分を生み出す現象です。パン、チーズ、ヨーグルト、味噌など、世界各地の食文化で利用されています。" },
  { slug: "sleep", title: "睡眠", reading: "すいみん", category: "健康", summary: "心身の回復と記憶に関わる睡眠の基礎知識。", body: "睡眠は身体の回復、感情の調整、記憶の整理に関係しています。必要な時間には個人差があり、規則的な生活や光、運動、室温なども睡眠の質へ影響します。" },
  { slug: "solar-system", title: "太陽系", reading: "たいようけい", category: "宇宙", summary: "太陽と、その周囲を公転する天体からなる系。", body: "太陽系には太陽、8つの惑星、準惑星、衛星、小惑星、彗星などが含まれます。約46億年前、ガスとちりの集まりから形成されたと考えられています。" },
  { slug: "information-literacy", title: "情報リテラシー", reading: "じょうほうりてらしー", category: "学び", summary: "情報の出所と信頼性を検討し、適切に利用する能力。", body: "情報リテラシーには、発信者、根拠、公開日、他の情報源との一致を確認する習慣が含まれます。情報を共有する前に一次情報へ当たることも大切です。" }
];

export function searchHubpediaArticles(query: string): HubpediaArticle[] {
  const normalized = normalizeHubpediaSearchText(query);
  if (!normalized) return HUBPEDIA_ARTICLES;
  return HUBPEDIA_ARTICLES.filter((article) =>
    normalizeHubpediaSearchText(`${article.title} ${article.reading ?? ""} ${article.category} ${article.summary} ${article.body ?? ""}`)
      .includes(normalized)
  );
}
import { normalizeHubpediaSearchText } from "./encyclopedia/search-text";
