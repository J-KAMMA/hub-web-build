import type { D1Database } from "@cloudflare/workers-types";

type PendingEvent = {
  id: string;
  thread_id: string;
  receiver_profile_id: string;
  delivery_mode: "digest" | "important";
  title: string;
  post_id: string;
  score: number;
  delivery_allowed: number;
};

export async function queueThreadFollowerNotifications(database:D1Database,input:{threadId:string;postId:string;actorProfileId:string;excludedProfileId?:string|null;createdAt:string}) {
  await database.prepare(`INSERT OR IGNORE INTO thread_notification_events
    (id,thread_id,post_id,receiver_profile_id,delivery_mode,status,created_at)
    SELECT lower(hex(randomblob(16))), ?, ?, profile_id, notification_mode, 'pending', ? FROM thread_tracking
    WHERE thread_id=? AND following=1 AND profile_id<>? AND profile_id<>COALESCE(?, '') AND notification_mode<>'none'
      AND NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = thread_tracking.profile_id
          AND moderation.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE control.blocked = 1 AND (
          (control.owner_profile_id = thread_tracking.profile_id AND control.target_profile_id = ?)
          OR (control.owner_profile_id = ? AND control.target_profile_id = thread_tracking.profile_id)
        )
      )`)
    .bind(
      input.threadId,
      input.postId,
      input.createdAt,
      input.threadId,
      input.actorProfileId,
      input.excludedProfileId ?? null,
      input.actorProfileId,
      input.actorProfileId,
    ).run();
  const instant=await database.prepare(`SELECT e.id,e.receiver_profile_id,t.title FROM thread_notification_events e
    JOIN threads t ON t.id=e.thread_id WHERE e.post_id=? AND e.delivery_mode='instant' AND e.status='pending'`)
    .bind(input.postId).all<{id:string;receiver_profile_id:string;title:string}>();
  if(instant.results.length) await database.batch(instant.results.flatMap(row=>[
    database.prepare(`INSERT INTO notifications(id,receiver_profile_id,actor_profile_id,notification_type,target_type,target_id,text,is_read,created_at)
      VALUES(?,?,NULL,'thread_reply','thread_post',?,?,0,?)`).bind(crypto.randomUUID(),row.receiver_profile_id,input.postId,`フォロー中の「${row.title}」に新しいレスがあります。`,input.createdAt),
    database.prepare("UPDATE thread_notification_events SET status='delivered',delivered_at=? WHERE id=?").bind(input.createdAt,row.id)
  ]));
}

export async function deliverPendingThreadNotifications(database:D1Database,now=new Date()) {
  const cutoff=new Date(now.getTime()-60*60*1000).toISOString();
  const result=await database.prepare(`SELECT e.id,e.thread_id,e.receiver_profile_id,e.delivery_mode,e.post_id,t.title,
    COALESCE(SUM(CASE WHEN r.kind='like' THEN 1 WHEN r.kind='dislike' THEN -1 ELSE 0 END),0) score,
    CASE WHEN
      NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id IN (e.receiver_profile_id, post.author_profile_id)
          AND moderation.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE control.blocked = 1 AND (
          (control.owner_profile_id = e.receiver_profile_id AND control.target_profile_id = post.author_profile_id)
          OR (control.owner_profile_id = post.author_profile_id AND control.target_profile_id = e.receiver_profile_id)
        )
      )
    THEN 1 ELSE 0 END delivery_allowed
    FROM thread_notification_events e
    JOIN threads t ON t.id=e.thread_id
    JOIN thread_posts post ON post.id=e.post_id
    LEFT JOIN reactions r ON r.target_type='thread_post' AND r.target_id=e.post_id
    WHERE e.status='pending' AND e.delivery_mode IN ('digest','important') AND e.created_at<=?
    GROUP BY e.id ORDER BY e.created_at LIMIT 500`).bind(cutoff).all<PendingEvent>();
  const deliver=result.results.filter(row=>Boolean(row.delivery_allowed)&&(row.delivery_mode==='digest'||row.score>=3));
  const skip=result.results.filter(row=>!row.delivery_allowed||(row.delivery_mode==='important'&&row.score<3));
  const groups=new Map<string,PendingEvent[]>();
  for(const row of deliver){const key=`${row.receiver_profile_id}:${row.thread_id}`;groups.set(key,[...(groups.get(key)??[]),row]);}
  const statements=[];
  for(const events of groups.values()){const first=events[0],latest=events.at(-1)!;statements.push(database.prepare(`INSERT INTO notifications(id,receiver_profile_id,actor_profile_id,notification_type,target_type,target_id,text,is_read,created_at)
    VALUES(?,?,NULL,'thread_reply','thread_post',?,?,0,?)`).bind(crypto.randomUUID(),first.receiver_profile_id,latest.post_id,`フォロー中の「${first.title}」に${events.length}件の新しいレスがあります。`,now.toISOString()));for(const event of events)statements.push(database.prepare("UPDATE thread_notification_events SET status='delivered',delivered_at=? WHERE id=?").bind(now.toISOString(),event.id));}
  for(const event of skip)statements.push(database.prepare("UPDATE thread_notification_events SET status='skipped',delivered_at=? WHERE id=?").bind(now.toISOString(),event.id));
  if(statements.length)await database.batch(statements);
  return {delivered:deliver.length,skipped:skip.length};
}
