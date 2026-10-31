export type TimelineCursor = {
  createdAt: string;
  id: string;
};

const POST_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function encodeTimelineCursor(cursor: TimelineCursor) {
  return `${encodeURIComponent(cursor.createdAt)}~${encodeURIComponent(cursor.id)}`;
}

export function decodeTimelineCursor(value: string | null | undefined): TimelineCursor | null {
  if (!value || value.length > 512) return null;
  const separator = value.lastIndexOf("~");
  if (separator <= 0 || separator === value.length - 1) return null;
  try {
    const createdAt = decodeURIComponent(value.slice(0, separator));
    const id = decodeURIComponent(value.slice(separator + 1));
    const date = new Date(createdAt);
    if (
      !Number.isFinite(date.getTime())
      || !POST_ID_PATTERN.test(id)
    ) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}
