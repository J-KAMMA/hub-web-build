import type { ReactNode } from "react";

import { AdultOptInGate } from "@/components/adult/adult-opt-in-gate";
import { AppShell } from "@/components/app-shell";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2Shell } from "@/components/v2/v2-shell";
import { hasAdultOptIn } from "@/lib/adult/opt-in";
import type { HubUiSurface } from "@/lib/hub-surface-path";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

/*
 * 成人向けの区分の外郭（2026-09-05、旦那様の「全部を v2 に」）。
 *
 * 確認していない人への重ねと inert の扱いが、5つの画面に同じ形で複製されて
 * いた。v2 の外郭を足すのに合わせて1か所へ寄せる。
 *
 * **本文は誰に対しても描く。** 確認していない人には上から重ねて inert に
 * するだけ。差し替えるとクローラーには確認画面しか届かず、索引に載らない。
 * inert は操作と支援技術にだけ効き、HTML からは消えない。
 * display:contents なので配置には影響しない。
 *
 * この区分は**わざと索引に載せている**。載せない側へ戻すときは、各画面の
 * metadata と lib/hub-request-policy.ts の X-Robots-Tag を必ず両方直す。
 */
export async function AdultPageShell({ surface, currentPath, searchContext, ownsHeading, gated = true, children }: {
  surface: HubUiSurface;
  /* 確認のあとに戻る道。面ごとに違う（/adult と /v2/adult）。 */
  currentPath: string;
  searchContext?: string;
  /* 本文が自分の h1 を持つとき。既存のシェルにだけ効く。 */
  ownsHeading?: boolean;
  /*
   * 確認を挟むか。掲載終了の知らせのように、**成人向けの中身が無い**
   * 画面では挟まない。年齢の確認を押させても見せるものが無い。
   */
  gated?: boolean;
  children: ReactNode;
}) {
  const optedIn = gated ? await hasAdultOptIn() : true;
  const body = (
    <>
      {optedIn ? null : <AdultOptInGate next={currentPath} />}
      <div inert={!optedIn} style={{ display: "contents" }}>
        {children}
      </div>
    </>
  );

  if (surface !== "/v2") {
    return (
      <AppShell currentPath={currentPath} notificationCount={0} messageCount={0} searchContext={searchContext} ownsHeading={ownsHeading}>
        {body}
      </AppShell>
    );
  }

  const [locale, shell] = await Promise.all([getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  return (
    <V2Shell
      currentPath={currentPath}
      profile={shell.currentProfile}
      items={v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount })}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      {body}
    </V2Shell>
  );
}
