import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { applyGroupMemberEvent } from "@/lib/server/community-federation-member";
import { applyGroupHostEvent, reconcileFederatedCommunities } from "@/lib/server/community-federation-host";
import { federationConfiguration } from "@/lib/server/federation-gateway";
import { fetchFederationGroupEvents, type GroupEvent } from "@/lib/server/federation-group-gateway";
import { pullFederationInbound, type PullResult } from "@/lib/server/federation-inbound";

/*
 * Federation の Group まわりの受信箱（GET /v1/group-events）を取り込む。
 * 個人の投稿の受信箱（/v1/inbound）とは別の列で、位置も別に持つ（federation_group_inbound_state）。
 * 取り込みのあと、Hub の既存の moderation の結果を Federation へ揃える（reconcile）。
 */

const PULL_BATCH = 50;
const MAX_BATCHES = 6;
const POISON_AFTER_ATTEMPTS = 3;
const STALE_AFTER_MS = 10_000;

const HOST_KINDS = new Set(["member_requested", "member_left", "post_received", "post_updated", "post_deleted"]);

export async function applyGroupEvent(database: D1Database, event: GroupEvent): Promise<void> {
  if (HOST_KINDS.has(event.kind)) return applyGroupHostEvent(database, event);
  return applyGroupMemberEvent(database, event);
}

type PullState = { cursor: string; stuck_cursor: string | null; stuck_attempts: number };

export async function pullFederationGroupEvents(
  database: D1Database,
  fetchPage: typeof fetchFederationGroupEvents = fetchFederationGroupEvents,
): Promise<PullResult> {
  const state = await database.prepare("SELECT cursor, stuck_cursor, stuck_attempts FROM federation_group_inbound_state WHERE id = 1")
    .first<PullState>() ?? { cursor: "0", stuck_cursor: null, stuck_attempts: 0 };
  let cursor = state.cursor;
  let stuckCursor = state.stuck_cursor;
  let stuckAttempts = state.stuck_attempts;
  let applied = 0;
  let skipped = 0;

  const persist = () => database.prepare(
    `INSERT INTO federation_group_inbound_state (id, cursor, last_pulled_at, stuck_cursor, stuck_attempts) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor, last_pulled_at = excluded.last_pulled_at,
       stuck_cursor = excluded.stuck_cursor, stuck_attempts = excluded.stuck_attempts`,
  ).bind(cursor, new Date().toISOString(), stuckCursor, stuckAttempts).run();

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const page = await fetchPage(cursor, PULL_BATCH);
    if (!page.ok) {
      await persist();
      return { applied, skipped, cursor, error: page.error };
    }
    for (const event of page.body.events) {
      try {
        await applyGroupEvent(database, event);
        applied += 1;
        cursor = String(event.seq);
        stuckCursor = null;
        stuckAttempts = 0;
      } catch {
        const seq = String(event.seq);
        stuckAttempts = stuckCursor === seq ? stuckAttempts + 1 : 1;
        stuckCursor = seq;
        if (stuckAttempts >= POISON_AFTER_ATTEMPTS) {
          console.error(JSON.stringify({ event: "federation_group_event_skipped", kind: event.kind, seq: event.seq }));
          skipped += 1;
          cursor = seq;
          stuckCursor = null;
          stuckAttempts = 0;
          continue;
        }
        await persist();
        return { applied, skipped, cursor, error: "event_failed" };
      }
    }
    if (!page.body.hasMore) break;
  }
  await persist();
  return { applied, skipped, cursor };
}

/** 個人の受信箱 → Group の受信箱 → Hub の状態の同期、を順に行う。定期ジョブと運営用の取り込み口が使う。 */
export async function pullFederationAll(database: D1Database) {
  const social = await pullFederationInbound(database);
  const groups = await pullFederationGroupEvents(database);
  try {
    await reconcileFederatedCommunities(database);
  } catch (error) {
    console.error(JSON.stringify({ event: "federation_reconcile_failed", category: error instanceof Error ? error.message.slice(0, 80) : "unknown" }));
  }
  return { ...social, groups };
}

/** 画面を開いたときの軽い取り込み。直前の取り込みから10秒以内なら何もしない。失敗しても画面は止めない。 */
export async function pullFederationGroupEventsIfStale(database: D1Database): Promise<void> {
  if (!federationConfiguration()) return;
  try {
    const state = await database.prepare("SELECT last_pulled_at FROM federation_group_inbound_state WHERE id = 1")
      .first<{ last_pulled_at: string | null }>();
    if (state?.last_pulled_at && Date.now() - Date.parse(state.last_pulled_at) < STALE_AFTER_MS) return;
    await Promise.race([
      (async () => {
        await pullFederationGroupEvents(database);
        await reconcileFederatedCommunities(database);
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch {
    // 受信箱に届かなくても画面は表示する。
  }
}
