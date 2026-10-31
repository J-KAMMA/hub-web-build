"use client";

import { V2DownloadButton, useContentDownloadSetting } from "./v2-content-download";

/**
 * Download button of a Hub self-made video. It appears only when the Hub API reports a setting
 * other than "none"; Hub checks the setting and the viewer's entitlement again on every press.
 */
export function V2VideoDownload({ videoId, japanese = true }: { videoId: string; japanese?: boolean }) {
  const { policy } = useContentDownloadSetting("video", videoId);
  if (!policy || policy === "none") return null;
  return (
    <section className="v2-download" aria-label={japanese ? "動画のダウンロード" : "Video download"}>
      <V2DownloadButton kind="video" id={videoId} allowed japanese={japanese} />
    </section>
  );
}
