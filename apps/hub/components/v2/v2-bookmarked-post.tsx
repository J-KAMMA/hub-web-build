"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { V2Post, type V2PostData } from "@/components/v2/v2-post";

export function V2BookmarkedPost({ post, viewerId, locale }: {
  post: V2PostData;
  viewerId: string;
  locale: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <V2Post post={post} viewerId={viewerId} locale={locale} onError={setError}
        onBookmarkChanged={() => router.refresh()} onRemoved={() => router.refresh()} />
      {error ? <p className="v2-error" role="alert">{error}</p> : null}
    </div>
  );
}
