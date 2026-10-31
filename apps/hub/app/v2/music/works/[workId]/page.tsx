import { permanentRedirect } from "next/navigation";
import { musicWorkHref } from "@/lib/music-work-href";

export const dynamic = "force-dynamic";

/* The per-song page was removed (2026-10-28). Old links keep working and open the song in place on the music home. */
export default async function MusicWorkRedirect({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  permanentRedirect(musicWorkHref(workId));
}
