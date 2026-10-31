import { WebSocketServer, type WebSocket } from "ws";

import { emptyZone, sweep, type Zone } from "../world/rules";
import { handle, newPace, type Outgoing, type Pace } from "../world/session";
import { readFileSync, writeFileSync } from "node:fs";

import { readBlockers } from "../world/collide";
import { CARVED } from "../world/carved";
import { audienceOf, readPass, Seats, UsedPasses } from "../world/entry";
import { readItems, visible } from "../world/items";
import { Allowed, readOwned, readWorn } from "../world/owned";
import { fetchBought, haveBought, readFetcher } from "./fetch-bought";
import { empty, fromRecord, prune, recall, remember, toRecord, type Remembered } from "../world/memory";
import { findZone, HUB_CITY, CITY_LAYOUT } from "../world/zones";

/**
 * 世界のサーバ。**薄い殻。**
 *
 * 規則はここに書かない。速さの上限も境界も定員も発言の間隔も、全部
 * `src/world/` にある。ここがするのは3つだけ:
 *
 * 1. 誰から来たかを添えて核へ渡す
 * 2. 返ってきたものを配る
 * 3. 黙ったままの人を定期的に片付ける
 *
 * ## なぜ Colyseus ではないのか
 *
 * Colyseus を使う判断だったが、**入らなかった**。0.17 のサーバに対応する客側
 * （colyseus.js）が未公開で、席の予約の形が違う（サーバは平らな
 * `{name, sessionId, roomId}` を返し、0.16 の客は `{room: {...}}` を期待する）。
 * 0.16 系のサーバへ下げようとしたが、0.16.0〜0.16.5 は**全ての版で公開時の
 * 依存が `workspace:^` のまま**で、npm から入らない。
 *
 * **規則を伝送路の外に置いてあるので、ここは差し替えれば済む。** 客側が公開
 * されたら、この殻だけを Colyseus の Room に置き換える。`src/world/` は動かない。
 */

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * Hub Account の公開鍵。**これが身元の根拠。**
 *
 * 置かれていないときは、名乗りだけで入れる稽古の形になる。その形では
 * **外へ開かない**——誰でも他人になれるので。
 */
/**
 * 鍵は、口座サービスから取りに行ける。**手で写して回らない。**
 *
 * 写す作業は必ずどこかで食い違う——写し忘れた所だけが「署名が合わない」と
 * 言い出し、鍵の話だと分かるまで時間が要る。ACCOUNT_ORIGIN が置かれていれば、
 * 起動時に取りに行く。**公開鍵なので、秘密として扱う必要はない。**
 *
 * 直に置かれているものが優先。取りに行けない場所でも動かせるようにしておく。
 */
async function loadAccountKey(): Promise<string> {
  const given = process.env.HUB_ACCOUNT_PUBLIC_KEY?.trim() ?? "";
  if (given) return given;
  const origin = process.env.ACCOUNT_ORIGIN?.trim() ?? "";
  if (!origin) return "";
  try {
    const url = new URL(origin);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    // 平文の経路から鍵を取らない。**すり替えられたら、誰でも他人になれる。**
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      console.error("ACCOUNT_ORIGIN が https ではない。鍵を取りに行かない。");
      return "";
    }
    const answer = await fetch(`${url.origin}/api/v1/assertions/public-key`, {
      signal: AbortSignal.timeout(8_000)
    });
    if (!answer.ok) throw new Error(String(answer.status));
    const body = await answer.json() as { alg?: unknown; spki?: unknown };
    if (body.alg !== "EdDSA" || typeof body.spki !== "string" || body.spki.length < 40) {
      throw new Error("形が違う");
    }
    console.log("口座の公開鍵を取り寄せた");
    return body.spki;
  } catch (error) {
    console.error("口座の公開鍵を取り寄せられない", error);
    return "";
  }
}

const ACCOUNT_KEY = await loadAccountKey();
const OPEN_TO_ANYONE = ACCOUNT_KEY === "";
const LOOPBACK = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";

if (OPEN_TO_ANYONE && !LOOPBACK) {
  // **稽古の形のまま外へ出さない。** 事故はいつも「とりあえず動かした」から起きる。
  console.error("身元を確かめる鍵が無いまま外向きに開こうとしている。止める。");
  process.exit(1);
}

/**
 * このサーバの名前。**第三者が建てるときに名乗る。**
 *
 * 名乗ると、宛先が jkamma-hub-world:<名前> になり、口座はこのサーバ専用の
 * 識別子を配る。名乗らなければこの台の世界として扱う。
 *
 * **分ける理由。** 宛先が1つだと、建てた人全員が同じ識別子を見る。
 * 突き合わせれば、誰がどのサーバを渡り歩いたかが筋になって見える。
 */
const AUDIENCE = audienceOf(process.env.WORLD_SERVER_NAME || null);
console.log(`宛先: ${AUDIENCE}`);

const used = new UsedPasses();
/**
 * 誰がどの買い物を置けるか。**接続の間だけ憶える。**
 *
 * 言い分は短命なので、置くたびに取り直させると押すたびに待たされる。
 * 一度通れば、その接続の間は置ける。切れれば消える——買ったことの記録では
 * ないので、消えて構わない。
 */
const allowed = new Allowed();
/**
 * 姿にしてよい品の控え。**置いてよい品とは別に持つ。**
 *
 * 一緒にすると、椅子を置く許可でその体を着られる。売る側から見れば別の品。
 */
const wearable = new Allowed();

/**
 * 買った品の絵の取り寄せ先。
 *
 * 置いていなければ取り寄せない。**手で取り込んだものは、そのまま使える**
 * （tools/take-in.mjs）——繋がるまでの間も、絵が出る形にしておく。
 */
const BOUGHT_FOLDER = process.env.WORLD_BOUGHT ?? "public/bought";
const fetcher = readFetcher(process.env, BOUGHT_FOLDER);
console.log(fetcher
  ? `買った物の取り寄せ先: ${fetcher.origin}`
  : "買った物は取り寄せない（手で取り込んだものだけ使う）");
/** 1つの口座が持てる接続の数。1人で部屋を埋められないようにする。 */
const seats = new Seats();

/**
 * 居た場所の記録。
 *
 * **今はファイル。** 一人用の手元でしか動かしていないので、これで足りる。
 * 人が増えたら、ここだけを差し替える——記録の形と検め方は memory.ts にある。
 */
const MEMORY_FILE = process.env.WORLD_MEMORY ?? ".world-memory.json";
let memory: Remembered = empty();
try {
  memory = fromRecord(JSON.parse(readFileSync(MEMORY_FILE, "utf8")), HUB_CITY.map((one) => one.id));
  console.log(`憶えている人: ${memory.size}`);
} catch {
  // 無ければ、無いまま始める。**壊れていても落とさない**——
  // 記録が読めないことは、世界が動かない理由にならない。
}

/**
 * 置かれた物の記録。
 *
 * **居た場所とは別に持つ。** 人の居場所は消えても困らないが、置いた物が消えると
 * 「作ったものが無くなる」ので、意味が違う。区画ごとに分けて持つ。
 */
const ITEMS_FILE = process.env.WORLD_ITEMS ?? ".world-items.json";
let keptItems: Record<string, unknown> = {};
try {
  const read = JSON.parse(readFileSync(ITEMS_FILE, "utf8"));
  if (typeof read === "object" && read !== null) keptItems = read as Record<string, unknown>;
} catch {
  // 無ければ、無いまま始める。**壊れていても落とさない。**
}

function keepItems(): void {
  try {
    const all: Record<string, unknown> = {};
    for (const [id, zone] of worlds) all[id] = zone.items;
    writeFileSync(ITEMS_FILE, JSON.stringify(all, null, 2), "utf8");
  } catch (error) {
    console.error("置いてある物を書けない", error);
  }
}

function keepMemory(): void {
  try {
    memory = prune(memory, Date.now());
    writeFileSync(MEMORY_FILE, JSON.stringify(toRecord(memory), null, 2), "utf8");
  } catch (error) {
    console.error("記録を書けない", error);
  }
}

type Seat = {
  socket: WebSocket;
  id: string;
  zone: string;
  /** 許可に入っていた表示名。**あるなら、客の名乗りより優先する。** */
  name: string | null;
};

const worlds = new Map<string, Zone>();
const paces = new Map<string, Pace>();
for (const spec of HUB_CITY) {
  // **街と一緒に書き出された当たり判定を読む。** 手で書くと必ず食い違う。
  const blockers = readBlockers(CARVED[spec.id] ?? []);
  worlds.set(spec.id, emptyZone(spec.id, {
    capacity: spec.capacity, radius: spec.radius, carved: blockers,
    items: readItems(keptItems[spec.id], spec.radius)
  }));
  paces.set(spec.id, newPace());
  console.log(`${spec.id}: 通れない場所 ${blockers.length}`);
}

const seatsOpen = new Set<Seat>();
let nextId = 0;

const server = new WebSocketServer({ host: HOST, port: PORT });

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function deliver(zoneId: string, replies: Outgoing[], from: Seat): void {
  for (const reply of replies) {
    if (reply.to === "本人") {
      send(from.socket, reply);
      continue;
    }
    for (const seat of seatsOpen) {
      if (seat.zone === zoneId) send(seat.socket, reply);
    }
  }
}

function take(seat: Seat, payload: unknown): void {
  // **名乗りを上書きする。** 許可に名前が入っているなら、それが正しい名前。
  if (typeof payload === "object" && payload !== null &&
      (payload as { kind?: unknown }).kind === "入る") {
    const before = recall(memory, seat.id);
    payload = {
      ...(payload as object),
      ...(seat.name ? { name: seat.name } : {}),
      // **同じ区画に居たときだけ戻す。** 別の区画の座標を持ち込むと、
      // 広さが違うので変な場所に立つ。
      from: before && before.zone === seat.zone ? { x: before.x, z: before.z } : null
    };
  }
  const zone = worlds.get(seat.zone);
  const pace = paces.get(seat.zone);
  if (!zone || !pace) return;
  const done = handle(zone, pace, seat.id, payload, Date.now(),
    (who, content) => allowed.may(who, content),
    (who, content) => wearable.may(who, content));
  worlds.set(seat.zone, done.zone);
  paces.set(seat.zone, done.pace);
  deliver(seat.zone, done.replies, seat);
  // **置いた直後に書く。** 定期の書き出しに任せると、落ちた回のぶんが消える。
  // 置いた物が消えるのは、居場所が消えるのとは重みが違う。
  if (done.zone.items !== zone.items) keepItems();
}

server.on("connection", (socket, request) => { void openSeat(socket, request); });

/** 1本受ける。**検めが非同期なので、繋がった直後は何も送らない。** */
async function openSeat(socket: WebSocket, request: import("node:http").IncomingMessage): Promise<void> {
  // 区画は接続先で決める。**入れない区画名は広場へ落とす**——知らない名前で
  // 部屋を無限に作らせない。
  const asked = new URL(request.url ?? "/", "ws://x").searchParams.get("zone") ?? "city";
  const spec = findZone(HUB_CITY, asked) ?? HUB_CITY[0]!;

  /**
   * 身元を決める。**客が名乗った名前は使わない。**
   *
   * 許可が要る形では、許可の sub が身元で、名前も許可に入っているものを使う。
   * 稽古の形（鍵が無い）だけ、繋いだ順の番号で通す。
   */
  const pass = OPEN_TO_ANYONE
    ? null
    : await readPass(new URL(request.url ?? "/", "ws://x").searchParams.get("pass"), ACCOUNT_KEY, AUDIENCE);

  if (!OPEN_TO_ANYONE) {
    // 通らない理由は返さない。試す側に手掛かりを与えることになる。
    if (!pass || !used.take(pass.jti)) {
      socket.close(4001, "入れません");
      return;
    }
  }

  nextId += 1;
  const seat: Seat = { socket, id: pass ? pass.subject : `s${nextId}`, zone: spec.id, name: pass?.name ?? null };

  // **1人で部屋を埋めさせない。** 許可は取り直せるので、許可だけでは防げない。
  if (!seats.take(seat.id)) {
    socket.close(4002, "つなぎすぎです");
    return;
  }
  // **許可を記録に残さない。** url をそのまま出したら、署名付きの許可が
  // まるごと記録に写っていた。記録は人が読むし、転送もされる。
  console.log(`接続 ${seat.id} → ${spec.id} (origin=${request.headers.origin ?? "無し"})`);
  seatsOpen.add(seat);
  // 出口も渡す。**行き先を画面が知らないと、区画を作っても出られない。**
  send(socket, {
    to: "本人", kind: "ここ",
    zone: spec.id, title: spec.title, style: spec.style, radius: spec.radius,
    layout: CITY_LAYOUT,
    you: seat.id,
    exits: spec.exits
      .map((id) => findZone(HUB_CITY, id))
      .filter((one): one is NonNullable<typeof one> => Boolean(one))
      .map((one) => ({ id: one.id, title: one.title }))
  });

  // **入った直後に、置いてある物も送る。** 誰かが動くまで何も見えないと、
  // 前に置いた物が消えたように見える。
  send(socket, { to: "本人", kind: "置いてある物", items: visible(worlds.get(spec.id)?.items ?? []) });

  socket.on("message", (raw) => { void hear(raw); });

  async function hear(raw: unknown): Promise<void> {
    let payload: unknown = null;
    try {
      // **読めないものは捨てる。** 例外で落とさない。
      payload = JSON.parse(String(raw));
    } catch {
      return;
    }
    // **買った物の言い分は、鍵を持つここで検める。** 核へ鍵を渡さない。
    if (typeof payload === "object" && payload !== null &&
        (payload as { kind?: unknown }).kind === "買った物を出す") {
      const proof = (payload as { proof?: unknown }).proof;
      const owned = ACCOUNT_KEY ? await readOwned(proof, ACCOUNT_KEY, AUDIENCE) : null;
      // **一度きり。** 入る許可と同じ扱いにする。使い回せると、盗んだ1本で
      // 何度でも置けることになる。
      const took = owned !== null && used.take(owned.jti) && allowed.take(seat.id, owned);
      // **置く前に取り寄せる。** 置いてから取りに行くと、置いた本人には
      // 見えないまま「置けました」と出る。
      if (took && fetcher && !haveBought(BOUGHT_FOLDER, owned!.content)) {
        void fetchBought(fetcher, owned!.content);
      }
      send(socket, took
        ? { to: "本人", kind: "買った物", content: owned!.content }
        : { to: "本人", kind: "断り", reason: "その品を置く権利がありません" });
      return;
    }

    // 姿にしてよい、という言い分。**用途が違うので、置く方とは別に検める。**
    if (typeof payload === "object" && payload !== null &&
        (payload as { kind?: unknown }).kind === "姿にする") {
      const proof = (payload as { proof?: unknown }).proof;
      const worn = ACCOUNT_KEY ? await readWorn(proof, ACCOUNT_KEY, AUDIENCE) : null;
      const took = worn !== null && used.take(worn.jti) && wearable.take(seat.id, worn);
      // **着る前に取り寄せる。** 取り寄せずに着せると、着た本人にだけ
      // 見えない体で立つことになる。
      if (took && fetcher && !haveBought(BOUGHT_FOLDER, worn!.content)) {
        await fetchBought(fetcher, worn!.content);
      }
      send(socket, took
        ? { to: "本人", kind: "姿", content: worn!.content }
        : { to: "本人", kind: "断り", reason: "その姿を着る権利がありません" });
      return;
    }
    take(seat, payload);
  }

  socket.on("close", () => {
    seats.release(seat.id);
    allowed.forget(seat.id);
    wearable.forget(seat.id);
    // **出る前に憶える。** 出た後だと、もう世界に居ない。
    const zone = worlds.get(seat.zone);
    const me = zone?.avatars.find((one) => one.id === seat.id);
    if (me) memory = remember(memory, seat.id, { zone: seat.zone, x: me.x, z: me.z }, Date.now());
    take(seat, { kind: "出る" });
    seatsOpen.delete(seat);
    keepMemory();
  });
  socket.on("error", () => {
    seats.release(seat.id);
    allowed.forget(seat.id);
    wearable.forget(seat.id);
    seatsOpen.delete(seat);
  });
}

// 黙ったままの人を片付ける。切断が届かないことがある。
setInterval(() => {
  for (const [id, zone] of worlds) {
    const after = sweep(zone, Date.now());
    if (after.avatars.length === zone.avatars.length) continue;
    worlds.set(id, after);
    for (const seat of seatsOpen) {
      if (seat.zone === id) {
        send(seat.socket, { to: "全員", kind: "居る人", avatars: after.avatars.map(({ movedAt: _m, ...rest }) => rest) });
      }
    }
  }
}, 5_000);

// **落ちることを前提にする。** 出るときだけ書くと、サーバが落ちた回の記録が
// 丸ごと消える。
setInterval(() => {
  for (const [id, zone] of worlds) {
    for (const avatar of zone.avatars) {
      memory = remember(memory, avatar.id, { zone: id, x: avatar.x, z: avatar.z }, Date.now());
    }
  }
  keepMemory();
}, 30_000);

console.log(`Hub World: ws://${HOST}:${PORT}`);
console.log(`区画: ${HUB_CITY.map((one) => `${one.id}(${one.title})`).join(" ")}`);
console.log(OPEN_TO_ANYONE
  ? "稽古の形: 誰でも名乗って入れる。127.0.0.1 の外へは開かない。"
  : "Hub Account の許可が要る形で動いている。");
