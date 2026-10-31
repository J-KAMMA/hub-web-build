import { DurableObject } from "cloudflare:workers";

import { CARVED } from "@jkamma/hub-world/carved";
import { readBlockers } from "@jkamma/hub-world/collide";
import { readItems, visible, type Item } from "@jkamma/hub-world/items";
import { Allowed, readOwned, readWorn } from "@jkamma/hub-world/owned";
import { MAX_TTL_SECONDS, readPass } from "@jkamma/hub-world/entry";
import { emptyZone, sweep, type Zone } from "@jkamma/hub-world/rules";
import { handle, newPace, type Outgoing, type Pace } from "@jkamma/hub-world/session";
import { findZone, HUB_CITY, CITY_LAYOUT } from "@jkamma/hub-world/zones";

/**
 * 3Dワールドの区画。**1区画が1つのオブジェクト。**
 *
 * 部屋という考え方に素直に合う。同じ区画に居る人は同じオブジェクトに繋がり、
 * 状態はそこにだけある——どの機械が受けたかを気にしなくてよくなる。
 *
 * **規則はここに書かない。** 速さの上限も境界も定員も、全部 `src/world/` に
 * ある。ここがするのは3つだけ:
 *
 * 1. 誰から来たかを添えて核へ渡す
 * 2. 返ってきたものを配る
 * 3. 黙ったままの人を定期的に片付ける
 *
 * ## なぜ VPS ではないのか
 *
 * 最初は VPS に置いた。「Workers では長い接続を保てない」と思い込んだため。
 * **同じリポジトリの中に実例があった**（FeedRealtimeShard）。確かめずに選んだ
 * のが間違いで、ここへ移した結果、DNS も証明書も別の配信元も要らなくなり、
 * Hub と同じ生い立ちになったので CORS も消えた。
 */

/** 眠っている間も残しておくもの。**起きたときに、誰が誰かを思い出せるように。** */
type Held = { id: string; zone: string; name: string | null };

/** 片付けと書き込みの間隔（ミリ秒）。 */
const TICK_MS = 5_000;

export class WorldZone extends DurableObject<CloudflareEnv> {
  private zone: Zone | null = null;
  private pace: Pace = newPace();
  private readonly allowed = new Allowed();
  /** 姿にしてよい品。**置いてよい品とは別に持つ。** 用途が違う。 */
  private readonly wearable = new Allowed();
  private items: Item[] = [];

  /**
   * 一度使った許可を、二度使わせない。
   *
   * **手元の変数では足りない。** 眠って起きるとオブジェクトは作り直され、
   * 手元に憶えていたものは消える。消えた後なら、使い終えた許可がもう一度通る。
   * 許可の寿命は300秒なので窓は短いが、短いだけで開いてはいる。記憶に残す。
   */
  private async takeOnce(jti: string, at = Date.now()): Promise<boolean> {
    const key = `jti:${jti}`;
    if (await this.ctx.storage.get<number>(key)) return false;
    // 寿命より少し長く持つ。**捨てないと、増え続けて溜まる。**
    await this.ctx.storage.put(key, at + (MAX_TTL_SECONDS + 60) * 1000);
    return true;
  }

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // **休眠を使う。** 人が黙っている間もオブジェクトを起こしておくと、
    // 居るだけで金がかかる。自動の応答だけ残して眠らせる。
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /**
   * 区画を用意する。**眠って起きた後もここを通る。**
   *
   * 置いてある物は記憶から読み直す。居場所は読み直さない——切れた人の
   * 居場所は、次に入るときに核が決める。
   */
  private async ready(zoneId: string): Promise<Zone> {
    if (this.zone && this.zone.id === zoneId) return this.zone;
    const spec = findZone(HUB_CITY, zoneId) ?? HUB_CITY[0]!;
    const kept = await this.ctx.storage.get<unknown>("items");
    this.items = readItems(kept, spec.radius);
    this.zone = emptyZone(spec.id, {
      capacity: spec.capacity,
      radius: spec.radius,
      carved: readBlockers(CARVED[spec.id] ?? []),
      items: this.items
    });
    this.pace = newPace();
    return this.zone;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("websocket が要ります", { status: 426 });
    }
    const url = new URL(request.url);
    const asked = url.searchParams.get("zone") ?? HUB_CITY[0]!.id;
    // **入れない区画名は先頭へ落とす。** 知らない名前で部屋を無限に作らせない。
    const spec = findZone(HUB_CITY, asked) ?? HUB_CITY[0]!;
    const zone = await this.ready(spec.id);

    const key = this.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "";
    // **鍵が無いまま通さない。** Hub と同じ生い立ちに居るので、
    // 「手元だから」で緩める理由が無い。
    if (!key) return new Response("身元を確かめられません", { status: 503 });

    const pass = await readPass(url.searchParams.get("pass"), key);
    // 通らない理由は返さない。試す側に手掛かりを与えることになる。
    if (!pass || !await this.takeOnce(pass.jti)) {
      return new Response("入れません", { status: 401 });
    }

    if (zone.avatars.length >= zone.capacity) {
      return new Response("満員です", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const held: Held = { id: pass.subject, zone: spec.id, name: pass.name };
    // **誰かを、接続そのものに書いておく。** 眠って起きたときに、
    // どの接続が誰かを思い出す手がかりがこれしかない。
    server.serializeAttachment(held);
    this.ctx.acceptWebSocket(server, [spec.id]);

    this.send(server, {
      to: "本人", kind: "ここ",
      zone: spec.id, title: spec.title, style: spec.style, radius: spec.radius,
      layout: CITY_LAYOUT,
      you: held.id,
      exits: spec.exits
        .map((id) => findZone(HUB_CITY, id))
        .filter((one): one is NonNullable<typeof one> => Boolean(one))
        .map((one) => ({ id: one.id, title: one.title }))
    });
    this.send(server, { to: "本人", kind: "置いてある物", items: visible(this.items) });
    void this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  private send(socket: WebSocket, message: unknown): void {
    try { socket.send(JSON.stringify(message)); } catch { /* 切れた口は runtime が畳む */ }
  }

  private deliver(replies: Outgoing[], from: WebSocket): void {
    for (const reply of replies) {
      if (reply.to === "本人") { this.send(from, reply); continue; }
      for (const socket of this.ctx.getWebSockets()) this.send(socket, reply);
    }
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const held = socket.deserializeAttachment() as Held | null;
    if (!held) { socket.close(1011, "誰か分からない"); return; }
    const zone = await this.ready(held.zone);

    let payload: unknown = null;
    try {
      // **読めないものは捨てる。** 例外で落とさない。
      payload = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    // **買った物の言い分は、鍵を持つここで検める。** 核へ鍵を渡さない。
    if (typeof payload === "object" && payload !== null &&
        (payload as { kind?: unknown }).kind === "買った物を出す") {
      const key = this.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "";
      const owned = key ? await readOwned((payload as { proof?: unknown }).proof, key) : null;
      // **一度きり。** 使い回せると、盗んだ1本で何度でも置ける。
      const took = owned !== null && await this.takeOnce(owned.jti) && this.allowed.take(held.id, owned);
      this.send(socket, took
        ? { to: "本人", kind: "買った物", content: owned!.content }
        : { to: "本人", kind: "断り", reason: "その品を置く権利がありません" });
      return;
    }

    // 姿にしてよい、という言い分。**置く許可では通らない。**
    if (typeof payload === "object" && payload !== null &&
        (payload as { kind?: unknown }).kind === "姿にする") {
      const key = this.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "";
      const worn = key ? await readWorn((payload as { proof?: unknown }).proof, key) : null;
      const took = worn !== null && await this.takeOnce(worn.jti) && this.wearable.take(held.id, worn);
      this.send(socket, took
        ? { to: "本人", kind: "姿", content: worn!.content }
        : { to: "本人", kind: "断り", reason: "その姿を着る権利がありません" });
      return;
    }

    // **名乗りを上書きする。** 許可に名前が入っているなら、それが正しい名前。
    if (typeof payload === "object" && payload !== null &&
        (payload as { kind?: unknown }).kind === "入る") {
      const before = await this.ctx.storage.get<{ x: number; z: number }>(`at:${held.id}`);
      payload = {
        ...(payload as object),
        ...(held.name ? { name: held.name } : {}),
        from: before ?? null
      };
    }

    const done = handle(zone, this.pace, held.id, payload, Date.now(),
      (who, content) => this.allowed.may(who, content),
      (who, content) => this.wearable.may(who, content));
    this.zone = done.zone;
    this.pace = done.pace;
    this.deliver(done.replies, socket);

    // **置いた直後に書く。** 定期の書き出しに任せると、眠った回のぶんが消える。
    if (done.zone.items !== this.items) {
      this.items = done.zone.items;
      await this.ctx.storage.put("items", this.items);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const held = socket.deserializeAttachment() as Held | null;
    if (!held || !this.zone) return;
    // **出る前に憶える。** 出た後だと、もう世界に居ない。
    const me = this.zone.avatars.find((one) => one.id === held.id);
    if (me) await this.ctx.storage.put(`at:${held.id}`, { x: me.x, z: me.z });
    this.allowed.forget(held.id);
    this.wearable.forget(held.id);
    const done = handle(this.zone, this.pace, held.id, { kind: "出る" }, Date.now());
    this.zone = done.zone;
    this.pace = done.pace;
    this.deliver(done.replies, socket);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "WebSocket error");
  }

  /**
   * 黙ったままの人を片付ける。**切断が届かないことがある。**
   *
   * 誰も居なくなったら、次の目覚ましを掛けない——起き続ける理由が無い。
   */
  async alarm(): Promise<void> {
    if (this.zone) {
      const after = sweep(this.zone, Date.now());
      if (after.avatars.length !== this.zone.avatars.length) {
        this.zone = after;
        for (const socket of this.ctx.getWebSockets()) {
          this.send(socket, { to: "全員", kind: "居る人", avatars: after.avatars.map(({ movedAt: _m, ...rest }) => rest) });
        }
      }
      for (const avatar of after.avatars) {
        await this.ctx.storage.put(`at:${avatar.id}`, { x: avatar.x, z: avatar.z });
      }
    }
    // 使い終えた許可の控えを捨てる。**寿命を過ぎたものは、もう役に立たない。**
    const now = Date.now();
    for (const [key, until] of await this.ctx.storage.list<number>({ prefix: "jti:" })) {
      if (until < now) await this.ctx.storage.delete(key);
    }

    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }
}
