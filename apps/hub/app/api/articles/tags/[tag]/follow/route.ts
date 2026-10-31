import { handleArticleWrite, json } from "@/lib/server/article-write-route";
import {
  TagFollowLimitError,
  TagFollowValidationError,
  followTag,
  isFollowingTag,
  parseFollowTag,
  unfollowTag,
} from "@/lib/server/d1-user-article-tag-follows";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ tag: string }> };

/* タグ頁と同じ読み方（URLの値を復号して前後の空白を落とす）。 */
async function readTag(params: Context["params"]): Promise<string> {
  const raw = (await params).tag;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 復号できなければ生の値で検証し、形が悪ければ400にする。
  }
  return parseFollowTag(decoded.normalize("NFKC"));
}

function mapError(error: unknown): Response | null {
  if (error instanceof TagFollowValidationError) return json({ error: error.message }, 400);
  if (error instanceof TagFollowLimitError) return json({ error: error.message }, 409);
  return null;
}

/** いまフォロー中か。 */
export async function GET(request: Request, { params }: Context) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    try {
      const tag = await readTag(params);
      return json({ following: await isFollowingTag(database, profile.id, tag) });
    } catch (error) {
      const mapped = mapError(error);
      if (mapped) return mapped;
      throw error;
    }
  }, { mutating: false });
}

export async function POST(request: Request, { params }: Context) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    try {
      const tag = await readTag(params);
      await followTag(database, profile.id, tag);
      return json({ following: true });
    } catch (error) {
      const mapped = mapError(error);
      if (mapped) return mapped;
      throw error;
    }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    try {
      const tag = await readTag(params);
      await unfollowTag(database, profile.id, tag);
      return json({ following: false });
    } catch (error) {
      const mapped = mapError(error);
      if (mapped) return mapped;
      throw error;
    }
  });
}
