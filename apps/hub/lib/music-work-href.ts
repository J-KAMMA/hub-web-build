/* The per-song page is gone (2026-10-28); a song link opens the music home with that song highlighted. */
export const musicWorkHref = (id: string): string => `/v2/music?work=${encodeURIComponent(id)}`;
