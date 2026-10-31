import type { ServerTimelinePost } from "@/lib/server/social-timeline-post";

export const MOCK_IMAGE_POSTS: ServerTimelinePost[] = [
  {
    id: "mock-image-rainy-street",
    authorProfileId: "profile-yoru",
    displayName: "Yoru",
    handle: "yoru_observer",
    identityMode: "account",
    body: "雨上がりの街を歩いた夜。濡れた路面に店の灯りが残っていました。",
    createdAt: "2026-07-18T10:20:00.000Z",
    replyToPostId: null,
    images: [{ id: "mock-rainy-street", url: "/mock-images/rainy-street.avif", width: 1024, height: 1536, altText: "雨上がりの日本の街と濡れた路面に映る店の灯り" }],
    replyCount: 3,
    repostCount: 5,
    quoteRepostCount: 1,
    likeCount: 42,
    score: 67,
    bookmarked: false,
    viewerReaction: null,
    referenced: null,
  },
  {
    id: "mock-image-reading-desk",
    authorProfileId: "profile-rin",
    displayName: "Rin",
    handle: "rin_cipher",
    identityMode: "account",
    body: "本と音楽を行き来するための、静かな読書机。",
    createdAt: "2026-07-18T08:10:00.000Z",
    replyToPostId: null,
    images: [{ id: "mock-reading-desk", url: "/mock-images/reading-desk.avif", width: 1254, height: 1254, altText: "開いた本と紅茶と植物とヘッドホンが置かれた読書机" }],
    replyCount: 2,
    repostCount: 3,
    quoteRepostCount: 0,
    likeCount: 31,
    score: 46,
    bookmarked: false,
    viewerReaction: null,
    referenced: null,
  },
  {
    id: "mock-image-seasonal-lunch",
    authorProfileId: "profile-noa",
    displayName: "Noa",
    handle: "noa_threads",
    identityMode: "account",
    body: "旬の野菜を中心にした、軽い昼ごはん。",
    createdAt: "2026-07-17T23:40:00.000Z",
    replyToPostId: null,
    images: [{ id: "mock-seasonal-lunch", url: "/mock-images/seasonal-lunch.avif", width: 1536, height: 1024, altText: "旬の野菜とスープとご飯を盛り付けた昼食" }],
    replyCount: 4,
    repostCount: 2,
    quoteRepostCount: 1,
    likeCount: 36,
    score: 55,
    bookmarked: false,
    viewerReaction: null,
    referenced: null,
  },
];

export const MOCK_IMAGE_COMMENTS: Record<string, ServerTimelinePost[]> = {
  "mock-image-rainy-street": [
    { ...MOCK_IMAGE_POSTS[1], id: "mock-comment-rain-1", body: "青い時間と暖かい灯りの対比がきれいです。", replyToPostId: "mock-image-rainy-street", images: [], score: 5 },
    { ...MOCK_IMAGE_POSTS[2], id: "mock-comment-rain-2", body: "雨上がりに歩きたくなる一枚ですね。", replyToPostId: "mock-image-rainy-street", images: [], score: 3 },
  ],
  "mock-image-reading-desk": [
    { ...MOCK_IMAGE_POSTS[0], id: "mock-comment-desk-1", body: "読書と音楽の組み合わせが落ち着きます。", replyToPostId: "mock-image-reading-desk", images: [], score: 2 },
  ],
  "mock-image-seasonal-lunch": [
    { ...MOCK_IMAGE_POSTS[1], id: "mock-comment-lunch-1", body: "色のバランスもよくておいしそうです。", replyToPostId: "mock-image-seasonal-lunch", images: [], score: 4 },
  ],
};

export function isMockImagePost(postId: string): boolean {
  return postId.startsWith("mock-image-");
}
