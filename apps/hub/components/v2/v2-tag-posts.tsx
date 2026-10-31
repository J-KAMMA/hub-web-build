"use client";

import { useState } from "react";

import { V2Post } from "@/components/v2/v2-post";
import type { AppShellTimelinePost } from "@/lib/server/app-shell-data";

/* タグの画面に並ぶ投稿。フィードと同じ V2Post で、取り足しはしない。 */
export function V2TagPosts({ posts: initial, viewerId, locale }: { posts: AppShellTimelinePost[]; viewerId: string; locale: string }) {
  const [posts, setPosts] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="v2-feed">
      {error ? <p className="v2-error" role="alert">{error}</p> : null}
      {posts.map((post) => (
        <div key={post.id}>
          <V2Post
            post={post}
            viewerId={viewerId}
            locale={locale}
            onError={setError}
            onCreated={(created) => setPosts((current) => [created, ...current])}
            onRemoved={(postId) => setPosts((current) => current.filter((item) => item.id !== postId))}
          />
        </div>
      ))}
    </div>
  );
}
