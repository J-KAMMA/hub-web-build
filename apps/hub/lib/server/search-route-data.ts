import "server-only";

import {
  getBoards,
  getCommunities,
  getCommunityChannelMessages,
  getCommunityChannels,
  getLists,
  getPostsForThread,
  getProfiles,
  getSocialPosts,
  getThreads,
  getTokenRankings
} from "@/lib/mock-data";
import { MOCK_VIDEOS } from "@/lib/mock-video-data";
import { getSeedHubpediaSearchResults } from "@/lib/encyclopedia/hubpedia-search-results";
import { decorateSocialTimelinePost } from "@/lib/server/social-timeline-post";
import { MOCK_IMAGE_POSTS } from "@/lib/mock-image-posts";
import { scoreSearchFields, searchTextMatches } from "@/lib/search-relevance";
import { WORK_SEARCH_ITEMS } from "@/lib/search-extra-catalog";

function includesQuery(parts: Array<string | undefined>, query: string) {
  return searchTextMatches(query, parts);
}

function imageRelevance(post: ReturnType<typeof decorateSocialTimelinePost>, query: string) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("ja").trim();
  const altText = (post.images ?? []).map((image) => image.altText ?? "").join(" ").normalize("NFKC").toLocaleLowerCase("ja");
  const body = post.body.normalize("NFKC").toLocaleLowerCase("ja");
  const author = `${post.displayName} ${post.handle ?? ""}`.normalize("NFKC").toLocaleLowerCase("ja");
  return (altText.trim() === normalized ? 80 : 0)
    + (altText.includes(normalized) ? 40 : 0)
    + (body.includes(normalized) ? 20 : 0)
    + (author.includes(normalized) ? 10 : 0);
}

export async function getSearchRouteData(query: string) {
  const boards = getBoards()
    .filter((board) => includesQuery([board.title, board.slug, board.description], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.title, weight: 10 }, { value: right.slug, weight: 7 }, { value: right.description, weight: 2 }]) - scoreSearchFields(query, [{ value: left.title, weight: 10 }, { value: left.slug, weight: 7 }, { value: left.description, weight: 2 }]) || right.threadCount - left.threadCount)
    .map((board) => ({
      id: board.id,
      key: board.key,
      title: board.title,
      slug: board.slug,
      description: board.description,
      threadCount: board.threadCount
    }));

  const profiles = getProfiles()
    .filter((profile) => !profile.isCurrentUser)
    .filter((profile) => includesQuery([profile.handle, profile.displayName, profile.bio], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.handle, weight: 12 }, { value: right.displayName, weight: 10 }, { value: right.bio, weight: 2 }]) - scoreSearchFields(query, [{ value: left.handle, weight: 12 }, { value: left.displayName, weight: 10 }, { value: left.bio, weight: 2 }]))
    .map((profile) => ({
      id: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio
    }));

  const threads = getThreads()
    .filter((thread) => includesQuery([
      thread.title,
      thread.boardKey,
      ...getPostsForThread(thread.id).flatMap((post) => [post.displayName, post.body]),
    ], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.title, weight: 12 }, { value: right.boardKey, weight: 4 }]) - scoreSearchFields(query, [{ value: left.title, weight: 12 }, { value: left.boardKey, weight: 4 }]) || right.postCount - left.postCount || right.updatedAt.localeCompare(left.updatedAt))
    .map((thread) => ({
      id: thread.id,
      boardKey: thread.boardKey,
      title: thread.title,
      postCount: thread.postCount,
      updatedAt: thread.updatedAt,
      pinned: thread.pinned ?? false
    }));

  const posts = getSocialPosts()
    .map(decorateSocialTimelinePost)
    .filter((post) => includesQuery([post.displayName, post.handle, post.body], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.handle, weight: 10 }, { value: right.displayName, weight: 8 }, { value: right.body, weight: 3 }]) - scoreSearchFields(query, [{ value: left.handle, weight: 10 }, { value: left.displayName, weight: 8 }, { value: left.body, weight: 3 }]) || right.score - left.score || right.createdAt.localeCompare(left.createdAt))
  const imageCandidates = [...posts.filter((post) => Boolean(post.images?.length)), ...(process.env.NODE_ENV === "production" ? [] : MOCK_IMAGE_POSTS)]
    .filter((post) => includesQuery([post.displayName, post.handle, post.body, ...(post.images ?? []).map((image) => image.altText)], query));
  const images = imageCandidates
    .sort((left, right) => imageRelevance(right, query) - imageRelevance(left, query) || right.score - left.score || right.createdAt.localeCompare(left.createdAt));

  const hubpediaSearch = await getSeedHubpediaSearchResults(query);
  const hubpedia = hubpediaSearch.results;
  const communities = getCommunities().filter((item) => {
    const channelContent = getCommunityChannels(item.id).flatMap((channel) => [
      channel.name,
      channel.description,
      ...getCommunityChannelMessages(channel.id).flatMap((message) => [message.body]),
    ]);
    return includesQuery([item.name, item.description, item.category, ...channelContent], query);
  })
    .sort((left, right) => scoreSearchFields(query, [{ value: right.name, weight: 12 }, { value: right.category, weight: 5 }, { value: right.description, weight: 2 }]) - scoreSearchFields(query, [{ value: left.name, weight: 12 }, { value: left.category, weight: 5 }, { value: left.description, weight: 2 }]))
    .map((item) => ({ id: item.id, slug: item.slug, name: item.name, description: item.description, category: item.category }));
  const videos = MOCK_VIDEOS.filter((item) => includesQuery([item.title, item.channel, item.category, item.topic], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.title, weight: 12 }, { value: right.channel, weight: 7 }, { value: right.topic, weight: 5 }, { value: right.category, weight: 3 }]) - scoreSearchFields(query, [{ value: left.title, weight: 12 }, { value: left.channel, weight: 7 }, { value: left.topic, weight: 5 }, { value: left.category, weight: 3 }]) || right.viewCount - left.viewCount)
    .map((item) => ({ id: item.id, title: item.title, channel: item.channel, category: item.category, topic: item.topic, provider: item.provider }));
  /* The external-shop product catalogue was removed (2026-10-15). */
  const products: never[] = [];
  const lists = getLists().filter((item) => item.visibility === "public" && includesQuery([item.name, item.description], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.name, weight: 12 }, { value: right.description, weight: 2 }]) - scoreSearchFields(query, [{ value: left.name, weight: 12 }, { value: left.description, weight: 2 }]))
    .map((item) => ({ id: item.id, name: item.name, description: item.description }));
  const tokens = getTokenRankings()
    .filter((item) => includesQuery([item.title, item.symbol, item.network, item.description], query))
    .sort((left, right) => scoreSearchFields(query, [{ value: right.symbol, weight: 12 }, { value: right.title, weight: 10 }, { value: right.network, weight: 4 }, { value: right.description, weight: 2 }]) - scoreSearchFields(query, [{ value: left.symbol, weight: 12 }, { value: left.title, weight: 10 }, { value: left.network, weight: 4 }, { value: left.description, weight: 2 }]))
    .map((item) => ({ id: item.id, title: item.title, symbol: item.symbol, network: item.network, description: item.description }));
  const work = WORK_SEARCH_ITEMS.filter((item) => includesQuery([item.title, item.organization, item.summary, item.location, item.compensation, ...item.tags], query));

  return {
    query,
    counts: {
      boards: boards.length,
      profiles: profiles.length,
      threads: threads.length,
      posts: posts.length,
      images: images.length,
      hubpedia: hubpediaSearch.count,
      communities: communities.length,
      videos: videos.length,
      products: products.length,
      lists: lists.length,
      tokens: tokens.length,
      work: work.length,
      listings: 0
    },
    boards,
    profiles,
    threads,
    posts,
    images,
    hubpedia,
    communities,
    videos,
    products,
    lists,
    tokens,
    work,
    listings: []
  };
}
