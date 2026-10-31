"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function MessageStartButton({ targetProfileId }: { targetProfileId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="inline-flex flex-col gap-2">
      <button
        type="button"
        className="button button--primary"
        disabled={isPending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const response = await fetch("/api/messages/start", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                target_profile_id: targetProfileId
              })
            });

            if (!response.ok) {
              const payload = (await response.json().catch(() => null)) as { error?: string } | null;
              setError(payload?.error ?? "会話の開始に失敗しました。");
              return;
            }

            const payload = (await response.json()) as { conversation_id: string };
            router.push(`/messages?conversation=${payload.conversation_id}`);
            router.refresh();
          });
        }}
      >
        {isPending ? "会話を準備中..." : "メッセージ"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
