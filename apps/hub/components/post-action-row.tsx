import React, { type ReactNode } from "react";

type PostActionRowProps = {
  reply: ReactNode;
  repost: ReactNode;
  like: ReactNode;
  bookmark: ReactNode;
  share: ReactNode;
  className?: string;
};

/**
 * Keeps the public conversation actions and private/external actions in one
 * stable order across every post surface.
 */
export function PostActionRow({
  reply,
  repost,
  like,
  bookmark,
  share,
  className = "",
}: PostActionRowProps) {
  return (
    <div className={`tweet__actions${className ? ` ${className}` : ""}`}>
      {reply}
      {repost}
      {like}
      {bookmark}
      {share}
    </div>
  );
}
