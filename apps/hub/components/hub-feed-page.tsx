import { cookies } from "next/headers";

import { Advertising } from "@/components/advertising";
import { AppShell } from "@/components/app-shell";
import { TimelineClient } from "@/components/timeline-client";
import { firstAdAfterItemFromSeed } from "@/lib/ad-insertion-schedule";
import { getHomePageData } from "@/lib/server/home-page-data";
import { getHubLocale } from "@/lib/server/locale";
import { getRemoteEngagementCounts } from "@/lib/server/federation-gateway";

export async function HubFeedPage({
  searchParams,
  currentPath = "/feed",
}: {
  searchParams: Promise<{ feed?: string | string[] }>;
  currentPath?: string;
}) {
  const [locale, cookieStore, query, data] = await Promise.all([
    getHubLocale(),
    cookies(),
    searchParams,
    getHomePageData(),
  ]);
  const {
    authenticated,
    currentProfile,
    notificationCount,
    messageCount,
    posts,
    threadResponses,
    follows,
    lists,
  } = data;
  const requestedFeed = Array.isArray(query.feed) ? query.feed[0] : query.feed;
  const savedFeed = cookieStore.get("hub.home.feed")?.value;
  const initialTab = requestedFeed === "recommended"
    || requestedFeed === "latest"
    || requestedFeed === "popular"
    || requestedFeed === "following"
    || requestedFeed === "lists"
    ? requestedFeed
    : savedFeed === "recommended"
      || savedFeed === "latest"
      || savedFeed === "popular"
      || savedFeed === "following"
      || savedFeed === "lists"
      ? savedFeed
      : "recommended";
  const remoteEngagements = await getRemoteEngagementCounts(posts.map((post) => post.id));
  const federatedPosts = posts.map((post) => {
    const remote = remoteEngagements[post.id];
    if (!remote) return post;
    return {
      ...post,
      // 他のハブからの返信・いいねは Federation の受信箱から Hub の行として取り込むので、ここで足すと二重に数える。
      repostCount: post.repostCount + remote.repost,
      score: post.score + remote.repost * 2,
    };
  });
  return (
    <AppShell
      currentPath={currentPath}
      notificationCount={notificationCount}
      messageCount={messageCount}
      shellData={{
        currentProfile,
        socialPosts: federatedPosts,
        follows,
        lists,
        unreadIndicatorCount: notificationCount,
        unreadMessageCount: messageCount,
      }}
    >
      <TimelineClient
        authenticated={authenticated}
        locale={locale}
        initialTab={initialTab}
        adFirstAfterItem={firstAdAfterItemFromSeed(
          cookieStore.get("hub.ads.frequency")?.value,
        )}
        posts={federatedPosts}
        threadResponses={threadResponses}
        currentUserDisplayName={currentProfile.displayName}
        currentUserAvatarUrl={currentProfile.avatarUrl}
        currentProfileId={currentProfile.id}
        follows={follows}
        lists={lists}
        inlineAd={(
          <Advertising
            placement="home"
            contextText="コミュニティ デジタル社会 公共政策 ガバナンス"
            locale={locale}
            showSponsor
          />
        )}
      />
    </AppShell>
  );
}
