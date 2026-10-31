import "server-only";

import { listGameScreenshots } from "@/lib/server/d1-game-store";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

type GameRow = { id: string; slug: string; title: string; summary: string; image_url: string | null; updated_at: string; platforms?: string | null; release_date?: string | null;
  store_listing?: "free" | "paid" | null; commerce_product_id?: string | null; requirements_minimum?: string | null; requirements_recommended?: string | null;
  age_rating?: "all" | "12" | "15" | "18" | null };
type CommunityRow = { id: string; slug: string; name: string; image_url: string | null; role: "maintainer" | "contributor" };
type DirectoryRow = { id: string; community_id: string; parent_directory_id: string | null; slug: string; name: string };
type PageRow = { id: string; community_id: string; directory_id: string | null; slug: string; title: string; body: string; version: number; updated_at: string; verification_status: "unverified" | "verified" | "recheck_required"; verification_count: number; game_version: string | null };

export type PublicGameGuideVariant = {
  id: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
  verificationStatus: "unverified" | "verified" | "recheck_required";
  verificationCount: number;
  gameVersion?: string;
};

export type PublicGameGuide = {
  path: string;
  title: string;
  sectionNames: string[];
  updatedAt: string;
  canonical: PublicGameGuideVariant;
  variants: PublicGameGuideVariant[];
};

export type PublicGameGuideHub = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  isFixture: boolean;
  imageUrl?: string;
  /** Platform names as stored on the hub (game_guide_hubs.platforms). */
  platforms: string[];
  releaseDate: string | null;
  /** Store listing (0272): free games are added to the library without Commerce; paid games name one Commerce product. */
  storeListing: "free" | "paid" | null;
  commerceProductId: string | null;
  /** The creator's age rating (0273); "all" when unset. */
  ageRating: "all" | "12" | "15" | "18";
  requirementsMinimum: string | null;
  requirementsRecommended: string | null;
  screenshots: Array<{ id: string; url: string }>;
  updatedAt: string;
  communities: Array<{ id: string; slug: string; name: string; imageUrl?: string; role: "maintainer" | "contributor" }>;
  guides: PublicGameGuide[];
};

function directorySegments(directoryId: string | null, directories: Map<string, DirectoryRow>) {
  const slugs: string[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  let current = directoryId ? directories.get(directoryId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    slugs.unshift(current.slug);
    names.unshift(current.name);
    current = current.parent_directory_id ? directories.get(current.parent_directory_id) : undefined;
  }
  return { slugs, names };
}

function gameGuideFixturesEnabled() {
  return process.env.NODE_ENV !== "production" &&
    process.env.HUB_GAME_GUIDE_FIXTURES === "1";
}

const FIXTURE_PLATFORMS = ["PC", "PlayStation 4", "Xbox One"] as const;

async function getFixtureFalloutHub(): Promise<PublicGameGuideHub> {
  const {
    getCommunities,
    getCommunityGuideDirectories,
    getCommunityGuidePages,
  } = await import("@/lib/mock-data");
  const community = getCommunities().find((candidate) => candidate.id === "community-fallout4")!;
  const directories = new Map(getCommunityGuideDirectories(community.id).map((directory) => [directory.id, {
    id: directory.id, community_id: directory.communityId,
    parent_directory_id: directory.parentDirectoryId ?? null,
    slug: directory.slug, name: directory.name,
  }]));
  const guides = getCommunityGuidePages(community.id).map((page) => {
    const directory = directorySegments(page.directoryId ?? null, directories);
    const variant: PublicGameGuideVariant = {
      id: page.id, communityId: community.id, communitySlug: community.slug,
      communityName: community.name, title: page.title, body: page.body,
      version: page.version, updatedAt: page.updatedAt,
      verificationStatus: "unverified", verificationCount: 0,
    };
    return {
      path: [...directory.slugs, page.slug].join("/"), title: page.title,
      sectionNames: directory.names, updatedAt: page.updatedAt,
      canonical: variant, variants: [variant],
    };
  });
  return {
    id: "game-fallout-4", slug: "fallout-4", title: "Fallout 4 攻略ハブ（サンプル）",
    summary: "攻略ハブの表示と操作を確認するための開発用サンプルです。公開済みの攻略情報ではありません。",
    isFixture: true,
    imageUrl: "/community-fallout4.webp", platforms: [...FIXTURE_PLATFORMS], releaseDate: null,
    storeListing: null, commerceProductId: null, ageRating: "all", requirementsMinimum: null, requirementsRecommended: null, screenshots: [],
    updatedAt: guides[0]?.updatedAt ?? community.createdAt,
    communities: [{ id: community.id, slug: community.slug, name: community.name, imageUrl: community.imageUrl, role: "maintainer" }],
    guides,
  };
}

function parsePlatforms(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function getPublicGameGuideHub(gameSlug: string): Promise<PublicGameGuideHub | null> {
  const database = getOptionalHubD1();
  if (!database) {
    return gameGuideFixturesEnabled() && gameSlug === "fallout-4"
      ? getFixtureFalloutHub()
      : null;
  }
  const game = await database.prepare(`SELECT id, slug, title, summary, image_url, updated_at, platforms, release_date,
      store_listing, commerce_product_id, requirements_minimum, requirements_recommended, age_rating
    FROM game_guide_hubs WHERE slug = ? AND status = 'published' LIMIT 1`).bind(gameSlug).first<GameRow>();
  if (!game) {
    return gameGuideFixturesEnabled() && gameSlug === "fallout-4"
      ? getFixtureFalloutHub()
      : null;
  }
  const [communityResult, directoryResult, pageResult, screenshots] = await Promise.all([
    database.prepare(`SELECT c.id, c.slug, c.name, c.image_url, l.role
      FROM game_guide_community_links l JOIN communities c ON c.id = l.community_id
      WHERE l.game_id = ? AND l.approved_at IS NOT NULL AND c.visibility = 'public' ORDER BY l.role, c.name`).bind(game.id).all<CommunityRow>(),
    database.prepare(`SELECT d.id, d.community_id, d.parent_directory_id, d.slug, d.name
      FROM community_guide_directories d
      JOIN game_guide_community_links l ON l.community_id = d.community_id
      JOIN communities c ON c.id = d.community_id
      WHERE l.game_id = ? AND l.approved_at IS NOT NULL AND c.visibility = 'public' ORDER BY d.position, d.name`).bind(game.id).all<DirectoryRow>(),
    database.prepare(`SELECT p.id, p.community_id, p.directory_id, p.slug, p.title, p.body, p.version, p.updated_at,
        p.verification_status, p.verification_count, p.game_version
      FROM community_guide_pages p
      JOIN game_guide_community_links l ON l.community_id = p.community_id
      JOIN communities c ON c.id = p.community_id
      WHERE l.game_id = ? AND l.approved_at IS NOT NULL AND c.visibility = 'public' ORDER BY p.updated_at DESC`).bind(game.id).all<PageRow>(),
    listGameScreenshots(database, game.id),
  ]);
  const communities = communityResult.results ?? [];
  const communityMap = new Map(communities.map((community) => [community.id, community]));
  const directoryMap = new Map((directoryResult.results ?? []).map((directory) => [directory.id, directory]));
  const grouped = new Map<string, { names: string[]; variants: PublicGameGuideVariant[] }>();
  for (const page of pageResult.results ?? []) {
    const community = communityMap.get(page.community_id);
    if (!community) continue;
    const directory = directorySegments(page.directory_id, directoryMap);
    const path = [...directory.slugs, page.slug].join("/");
    const variant: PublicGameGuideVariant = {
      id: page.id, communityId: community.id, communitySlug: community.slug,
      communityName: community.name, title: page.title, body: page.body,
      version: Number(page.version), updatedAt: page.updated_at,
      verificationStatus: page.verification_status, verificationCount: Number(page.verification_count),
      gameVersion: page.game_version ?? undefined,
    };
    const entry = grouped.get(path) ?? { names: directory.names, variants: [] };
    entry.variants.push(variant);
    grouped.set(path, entry);
  }
  const guides = [...grouped.entries()].map(([path, entry]) => {
    const rank = { verified: 2, recheck_required: 1, unverified: 0 } as const;
    const variants = entry.variants.sort((left, right) => rank[right.verificationStatus] - rank[left.verificationStatus] || right.verificationCount - left.verificationCount || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return { path, title: variants[0].title, sectionNames: entry.names, updatedAt: variants[0].updatedAt, canonical: variants[0], variants };
  }).sort((left, right) => left.path.localeCompare(right.path, "ja"));
  return {
    id: game.id, slug: game.slug, title: game.title, summary: game.summary,
    isFixture: false,
    imageUrl: game.image_url ?? undefined, updatedAt: game.updated_at,
    platforms: parsePlatforms(game.platforms), releaseDate: game.release_date ?? null,
    storeListing: game.store_listing ?? null,
    commerceProductId: game.store_listing === "paid" ? game.commerce_product_id ?? null : null,
    ageRating: game.age_rating ?? "all",
    requirementsMinimum: game.requirements_minimum ?? null,
    requirementsRecommended: game.requirements_recommended ?? null,
    screenshots: screenshots.map((shot) => ({ id: shot.id, url: shot.url })),
    communities: communities.map((community) => ({
      id: community.id, slug: community.slug, name: community.name,
      imageUrl: community.image_url ?? undefined, role: community.role,
    })),
    guides,
  };
}

export async function getPublicGameGuide(gameSlug: string, guidePath: string) {
  const hub = await getPublicGameGuideHub(gameSlug);
  if (!hub) return null;
  const guide = hub.guides.find((candidate) => candidate.path === guidePath);
  return guide ? { hub, guide } : null;
}

export async function listPublicGameGuideHubs() {
  const database = getOptionalHubD1();
  if (!database) {
    return gameGuideFixturesEnabled() ? [await getFixtureFalloutHub()] : [];
  }
  const result = await database.prepare(`SELECT slug FROM game_guide_hubs WHERE status = 'published' ORDER BY updated_at DESC`).all<{ slug: string }>();
  const hubs = (await Promise.all((result.results ?? []).map((row) => getPublicGameGuideHub(row.slug))))
    .filter((hub): hub is PublicGameGuideHub => Boolean(hub));
  return hubs.length || !gameGuideFixturesEnabled()
    ? hubs
    : [await getFixtureFalloutHub()];
}

export type PublicGameSearchResult = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  imageUrl?: string;
  platforms: string[];
  releaseDate: string | null;
  communityCount: number;
  guideCount: number;
  isFixture: boolean;
};

async function fixtureSearchResults(query: string, platform: string) {
  if (!gameGuideFixturesEnabled()) return [];
  const fixture = await getFixtureFalloutHub();
  const platforms: string[] = [...FIXTURE_PLATFORMS];
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  if (
    normalizedQuery &&
    !`${fixture.title} ${fixture.summary} FO4 フォールアウト4`
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
      .includes(normalizedQuery)
  ) return [];
  if (platform && !platforms.includes(platform)) return [];
  return [{
    id: fixture.id,
    slug: fixture.slug,
    title: fixture.title,
    summary: fixture.summary,
    imageUrl: fixture.imageUrl,
    platforms,
    releaseDate: null,
    communityCount: fixture.communities.length,
    guideCount: fixture.guides.length,
    isFixture: true,
  }];
}

/*
 * storeOnly (2026-10-29): the store (/v2/games) lists only games with a store listing - free, or paid with a
 * linked Commerce product. A guide-only hub (and the sample fixture) belongs to /v2/community/games.
 */
export const STORE_LISTED_SQL = `g.store_listing IS NOT NULL AND (g.store_listing = 'free' OR (g.store_listing = 'paid' AND g.commerce_product_id IS NOT NULL))`;

export async function searchPublicGames(query = "", platform = "", options: { storeOnly?: boolean } = {}): Promise<PublicGameSearchResult[]> {
  const database = getOptionalHubD1();
  const storeOnly = options.storeOnly === true;
  if (!database) return storeOnly ? [] : fixtureSearchResults(query, platform);
  const like = `%${query.trim().slice(0, 80)}%`;
  const platformLike = `%${platform.trim().slice(0, 40)}%`;
  const result = await database.prepare(`SELECT g.id, g.slug, g.title, g.summary, g.image_url, g.platforms, g.release_date,
      COUNT(DISTINCT l.community_id) AS community_count, COUNT(DISTINCT p.id) AS guide_count
    FROM game_guide_hubs g
    LEFT JOIN game_guide_community_links l ON l.game_id = g.id AND l.approved_at IS NOT NULL
    LEFT JOIN community_guide_pages p ON p.community_id = l.community_id
    WHERE g.status = 'published' AND (? = '%%' OR g.title LIKE ? OR g.aliases LIKE ?)
      AND (? = '%%' OR g.platforms LIKE ?)${storeOnly ? ` AND ${STORE_LISTED_SQL}` : ""}
    GROUP BY g.id ORDER BY guide_count DESC, g.updated_at DESC`)
    .bind(like, like, like, platformLike, platformLike)
    .all<{ id: string; slug: string; title: string; summary: string; image_url: string | null; platforms: string; release_date: string | null; community_count: number; guide_count: number }>();
  const games = (result.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    imageUrl: row.image_url ?? undefined,
    platforms: parsePlatforms(row.platforms),
    releaseDate: row.release_date,
    communityCount: Number(row.community_count),
    guideCount: Number(row.guide_count),
    isFixture: false,
  }));
  return games.length || storeOnly ? games : fixtureSearchResults(query, platform);
}
