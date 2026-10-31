import { HUB_CATEGORIES, type HubCategoryId } from "@/lib/hub-taxonomy";
import { WORK_CATEGORY_TAXONOMY } from "@/lib/work-category-taxonomy";

export type MarketSectionId =
  | "tickets"
  | "work"
  | "jobs"
  | "travel"
  | "local-services"
  | "classes"
  | "events";

export type MarketTaxonomyGroup = {
  id: string;
  title: string;
  description: string;
  href: string;
  children: Array<{ id: string; label: string; href: string }>;
};

export type MarketTaxonomySection = {
  id: MarketSectionId;
  label: string;
  href: string;
  groups: MarketTaxonomyGroup[];
};

const ticketGroups = (ids: HubCategoryId[]): MarketTaxonomyGroup[] => ids
  .map((id) => HUB_CATEGORIES.find((category) => category.id === id))
  .filter((category): category is (typeof HUB_CATEGORIES)[number] => Boolean(category))
  .map((category) => ({
    id: category.id,
    title: category.label,
    description: category.description,
    href: `/market/tickets?category=${encodeURIComponent(category.id)}`,
    children: [],
  }));

const workGroups = (mode: "crowdsourcing" | "jobs", href: string): MarketTaxonomyGroup[] =>
  WORK_CATEGORY_TAXONOMY[mode].map((category) => ({
    id: category.id,
    title: category.label,
    description: category.children.map((child) => child.label).join("、"),
    href: `${href}?category=${encodeURIComponent(category.id)}`,
    children: category.children.map((child) => ({
      id: child.id,
      label: child.label,
      href: `${href}?category=${encodeURIComponent(child.id)}`,
    })),
  }));

export const marketTaxonomy: MarketTaxonomySection[] = [
  {
    id: "tickets",
    label: "チケット",
    href: "/market/tickets",
    groups: ticketGroups(["music", "sports", "culture", "community"]),
  },
  { id: "work", label: "仕事", href: "/work", groups: workGroups("crowdsourcing", "/work") },
  { id: "jobs", label: "求人", href: "/jobs", groups: workGroups("jobs", "/jobs") },
  {
    id: "travel",
    label: "旅行",
    href: "/travel",
    groups: [
      { id: "stay", title: "宿泊", description: "宿泊施設の公式情報", href: "/travel?category=宿泊", children: [] },
      { id: "transport", title: "交通", description: "交通事業者の公式情報", href: "/travel?category=交通", children: [] },
      { id: "attraction", title: "観光施設", description: "観光施設と地域の案内", href: "/travel?category=観光施設", children: [] },
      { id: "experience", title: "体験", description: "現地体験の公式情報", href: "/travel?category=体験", children: [] },
      { id: "guide", title: "旅行情報", description: "旅先を選ぶための情報", href: "/travel?category=旅行情報", children: [] },
    ],
  },
  {
    id: "local-services",
    label: "地域サービス",
    href: "/local-services",
    groups: [
      { id: "life", title: "暮らし", description: "地域の生活サービス", href: "/local-services?category=暮らし", children: [] },
      { id: "repair", title: "修理・メンテナンス", description: "修理と保守の事業者情報", href: "/local-services?category=修理・メンテナンス", children: [] },
      { id: "wellness", title: "美容・健康", description: "美容・健康サービスの公開情報", href: "/local-services?category=美容・健康", children: [] },
      { id: "professional", title: "専門サービス", description: "専門事業者の公開情報", href: "/local-services?category=専門サービス", children: [] },
      { id: "community", title: "地域団体", description: "地域で活動する団体", href: "/local-services?category=地域団体", children: [] },
    ],
  },
  {
    id: "classes",
    label: "教室",
    href: "/classes",
    groups: [
      { id: "learning", title: "学習", description: "学習教室", href: "/classes?category=学習", children: [] },
      { id: "languages", title: "語学", description: "語学教室", href: "/classes?category=語学", children: [] },
      { id: "music", title: "音楽", description: "音楽教室", href: "/classes?category=音楽", children: [] },
      { id: "sports", title: "スポーツ", description: "スポーツ教室", href: "/classes?category=スポーツ", children: [] },
      { id: "culture", title: "趣味・文化", description: "趣味と文化の教室", href: "/classes?category=趣味・文化", children: [] },
    ],
  },
  {
    id: "events",
    label: "イベント",
    href: "/events",
    groups: [
      { id: "music", title: "音楽", description: "音楽イベント", href: "/events?category=音楽", children: [] },
      { id: "sports", title: "スポーツ", description: "スポーツイベント", href: "/events?category=スポーツ", children: [] },
      { id: "exhibition", title: "展示", description: "展示と展覧会", href: "/events?category=展示", children: [] },
      { id: "conference", title: "カンファレンス", description: "会議とカンファレンス", href: "/events?category=カンファレンス", children: [] },
      { id: "local", title: "地域イベント", description: "地域主催の催し", href: "/events?category=地域イベント", children: [] },
    ],
  },
];

export function getMarketTaxonomySection(id: MarketSectionId) {
  return marketTaxonomy.find((section) => section.id === id);
}
