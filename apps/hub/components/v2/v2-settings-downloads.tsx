import React from "react";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listOwnDownloadHistory } from "@/lib/server/download-history";

const TARGET_NAMES: Record<string, string> = { post: "投稿", article: "記事", video: "動画", music: "音楽" };

/* 自分がダウンロードした作品の記録（2026-10-17）。本人の行だけを読む。 */
export async function V2SettingsDownloads({ profileId }: { profileId: string }) {
  const database = getOptionalHubD1();
  const entries = database ? await listOwnDownloadHistory(database, profileId).catch(() => []) : [];
  return (
    <div className="v2-settings-downloads">
      <p className="v2-note">ダウンロードの記録は、発行から365日後に削除されます。</p>
      {entries.length === 0 ? (
        <p className="v2-note">ダウンロードの記録はありません。</p>
      ) : (
        <table>
          <thead>
            <tr><th scope="col">ダウンロードID</th><th scope="col">対象</th><th scope="col">日時</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.watermarkId}>
                <td><code>{entry.watermarkId}</code></td>
                <td>{TARGET_NAMES[entry.targetType] ?? entry.targetType}{entry.targetLabel ? `: ${entry.targetLabel}` : ""}</td>
                <td><time dateTime={entry.issuedAt}>{entry.issuedAt.slice(0, 16).replace("T", " ")} UTC</time></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
