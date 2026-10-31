import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Resident } from "./resident";
import { createStreetResident } from "./streetResident";
import { createAtmosphere } from "./atmosphere";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";

import { FREE_LOOKS } from "../world/looks";
import { LIMITS } from "../world/rules";
import type { Style } from "../world/zones";
import { loadZone } from "./ground";
import { movement } from "./movement";
import { loadThings, showThings } from "./things";
import { CATALOGUE, type Item, type ItemKind } from "../world/items";
import { createConnectionRetryGate } from "./connection-retry";

/**
 * 世界に入る画面。
 *
 * **視点は三人称。** アバターと服が経済になるので、自分の姿が見えないと成立
 * しない。一人称は後から足せる。
 *
 * **位置を決めるのはサーバ。** ここが送るのは「こう動きたい」という意思だけで、
 * 画面に映る自分の位置もサーバが返したものを使う。自前で進めて表示すると、
 * 手元では歩けているのに他人からは止まって見える、という食い違いが起きる。
 */

type Watcher = {
  id: string; name: string; x: number; z: number; facing: number;
  /** 着ている姿。買った品の名前。**古いサーバは送ってこない**ので、任意。 */
  look?: string;
};

/**
 * 世界を開くのに要る部品。
 *
 * **id で拾わない。** 拾う作りだと、この画面はその頁でしか動かない。Hub の
 * 中（/world）にも、単体の頁にも置けるように、置き場所を渡してもらう。
 */
export type Stage = {
  canvas: HTMLCanvasElement;
  roster: HTMLElement;
  banner: HTMLElement;
  doors: HTMLElement;
  /** 品物の棚。**置ける物を並べる場所。** */
  shelf: HTMLElement;
  log: HTMLElement;
  sayForm: HTMLFormElement;
  line: HTMLInputElement;
  controls?: HTMLElement;
};

export type WorldOptions = {
  /**
   * 彫った資産の置き場（末尾に / を付けない）。
   *
   * **Hub の中では頁の根が空いていない。** 単体の頁は / に置いているが、
   * Hub では他の物と衝突するので、置き場を選べるようにしておく。
   */
  assets?: string;
  /** 世界のつなぎ先。省くと、開いている生い立ちから決める。 */
  address?: string;
  /**
   * 第三者が建てたサーバの名前。
   *
   * **名乗ると、許可の宛先がそのサーバ専用になる。** 名乗らなければ、この台の
   * 世界として扱う。宛先を分けるのは、建てた人どうしが突き合わせても、
   * 同じ人だと分からないようにするため。
   */
  server?: string;
  /** 入る区画。 */
  zone?: string;
  /** 名乗り。許可が取れたときは、そちらの名前が優先される。 */
  name?: string;
};

/**
 * 世界を開く。**閉じる手を返す。**
 *
 * 返さないと、頁を移っても描き続け、繋ぎっぱなしになる。Hub のような
 * 頁を移る作りの中では、これが無いと必ず漏れる。
 */
export function openWorld(stage: Stage, options: WorldOptions = {}): () => void {
  const { canvas, roster, banner, doors, shelf, log, sayForm, line } = stage;
  const assets = options.assets ?? "";

  const engine = new Engine(canvas, true, { stencil: true });
  engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
  const scene = new Scene(engine);

  const camera = new ArcRotateCamera("視点", -Math.PI / 2 + 0.16, 1.43, 6.8, new Vector3(0, 1.35, 0), scene);
  camera.fov = 0.86;
  camera.maxZ = 950;
  camera.attachControl(canvas, true);
  camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
  camera.panningSensibility = 0;
  camera.wheelPrecision = 35;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "3Dワールド。WASDか矢印キーで移動、ドラッグで見回す");
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 26;
  camera.upperBetaLimit = Math.PI / 2.1;

  const sun = new DirectionalLight("陽", new Vector3(0.45, -0.8, 0.5), scene);
  sun.position.set(-45, 80, -50);
  sun.diffuse = new Color3(1, 0.89, 0.74);
  sun.intensity = 1.5;
  sun.shadowFrustumSize = 125;
  sun.autoCalcShadowZBounds = false;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 200;
  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002;
  shadows.normalBias = 0.06;
  shadows.setDarkness(0);
  const fill = new HemisphericLight("空の光", new Vector3(0, 1, 0), scene);
  fill.diffuse = new Color3(0.79, 0.89, 1);
  fill.groundColor = new Color3(0.37, 0.3, 0.23);
  fill.intensity = 0.35;
  const atmosphere = createAtmosphere(scene, camera);

  /** 名前は他人が書いた文字列。**textContent で入れる。** */
  function nameCell(text: string): HTMLElement {
  const cell = document.createElement("span");
  cell.textContent = text;
  return cell;
  }

  /** 画面に出ている物。**サーバの並びに合わせて足し引きする。** */
  const things = new Map<string, { root: import("@babylonjs/core/Meshes/transformNode").TransformNode | null; sign: Mesh | null }>();
  /** いま選んでいる品目。 */
  let picked: ItemKind = "椅子";

  const people = new Map<string, Resident>();
  const lastMotion = new Map<string, number>();
  let thingsLoading: Promise<boolean> | null = null;
  let me: string | null = null;
  let mine: Watcher | null = null;

  let style: Style = "現代都市";

  function show(people2: Watcher[]): void {
  const here = new Set(people2.map((one) => one.id));

  // 居なくなった人を消す。**残すと、幽霊が広場に立ち続ける。**
  for (const [id, person] of people) {
    if (here.has(id)) continue;
    person.drop();
    people.delete(id);
    lastMotion.delete(id);
  }

  for (const one of people2) {
    const look = typeof one.look === "string" && FREE_LOOKS.some(option => option.id === one.look) ? one.look : "";
    let person = people.get(one.id);
    if (person && person.look !== look) { person.drop(); people.delete(one.id); person = undefined; }
    if (!person) {
      person = createStreetResident(scene, look, assets, mesh => shadows.addShadowCaster(mesh));
      people.set(one.id, person);
      for (const mesh of person.root.getChildMeshes()) shadows.addShadowCaster(mesh);
    }
    const stepped = Math.hypot(one.x - person.wasAt.x, one.z - person.wasAt.z);
    if (stepped > 0.005) lastMotion.set(one.id, performance.now());
    person.wasAt.set(one.x, 0, one.z);
    person.root.position.set(one.x, 0, one.z);
    person.root.rotation.y = one.facing + Math.PI;
    if (one.id === me) {
      mine = one;
      camera.target.set(one.x, 1.2, one.z);
    }
  }

  roster.replaceChildren(
    ...people2.map((person) => {
      const row = document.createElement("li");
      row.append(nameCell(person.name));
      if (person.id === me) row.append(nameCell("（自分）"));
      return row;
    })
  );
  }

  type Door = { id: string; title: string };

  /**
   * 品物の棚。
   *
   * **置くのは自分の足元の少し前。** 画面を押した場所へ置く形にすると、
   * 遠くの壁の向こうを狙えてしまい、置ける場所の規則を画面側にも書くことに
   * なる。規則はサーバにしか無い方がいい。
   */
  function showShelf(): void {
    const buttons: HTMLElement[] = [];
    for (const kind of Object.keys(CATALOGUE) as ItemKind[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = kind;
      button.dataset.kind = kind;
      if (kind === picked) button.setAttribute("aria-pressed", "true");
      button.addEventListener("click", () => {
        picked = kind;
        for (const other of buttons) other.removeAttribute("aria-pressed");
        button.setAttribute("aria-pressed", "true");
      });
      buttons.push(button);
    }

    const put = document.createElement("button");
    put.type = "button";
    put.textContent = "置く";
    put.className = "置く";
    put.addEventListener("click", () => {
      if (!mine) return;
      const ahead = 2.2;
      const text = CATALOGUE[picked].writable
        ? prompt("立て札に書く言葉") ?? ""
        : "";
      tell({
        kind: "置く", item: picked,
        x: mine.x + Math.sin(mine.facing) * ahead,
        z: mine.z + Math.cos(mine.facing) * ahead,
        // 置いた物は、置いた人の方を向く。背を向けて立つ椅子は落ち着かない。
        facing: mine.facing + Math.PI,
        text
      });
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "片付ける";
    clear.addEventListener("click", () => {
      if (!mine || !me) return;
      // **自分の物のうち、いちばん近いもの。** 片付けられるのは置いた人だけ
      // なので、他人の物を選んでも断られるだけ。
      let nearest: Item | null = null;
      let best = Infinity;
      for (const [, item] of placed) {
        if (item.owner !== me) continue;
        const far = Math.hypot(item.x - mine.x, item.z - mine.z);
        if (far < best) { best = far; nearest = item; }
      }
      if (nearest) tell({ kind: "片付ける", id: nearest.id });
      else banner.textContent = "片付けられる物が近くにありません";
    });

    /**
     * 通報。**近くの、他人の物。**
     *
     * 自分の物は片付ければよいので、ここには出さない。誰にでも押せるが、
     * 決めた人数に届くまで隠れない——1人で消せる道具にしない。
     */
    const flag = document.createElement("button");
    flag.type = "button";
    flag.textContent = "通報する";
    flag.addEventListener("click", () => {
      if (!mine || !me) return;
      let nearest: Item | null = null;
      let best = Infinity;
      for (const [, item] of placed) {
        if (item.owner === me) continue;
        const far = Math.hypot(item.x - mine.x, item.z - mine.z);
        if (far < best) { best = far; nearest = item; }
      }
      if (!nearest) { banner.textContent = "通報できる物が近くにありません"; return; }
      if (!confirm("この物を通報しますか。")) return;
      tell({ kind: "通報する", id: nearest.id });
    });

    shelf.replaceChildren(...buttons, put, clear, flag, wardrobe());
  }

  /**
   * 着替えの棚。
   *
   * **押した瞬間に押された印を移す。** 返事を待って印を付けると、押したのに
   * 何も起きていないように見える。実際に姿が替わるのは、サーバが配り直した
   * 名簿を受け取ったとき。
   */
  function wardrobe(): HTMLElement {
    const rack = document.createElement("div");
    rack.className = "姿";
    const label = document.createElement("span");
    label.textContent = "姿";
    rack.append(label);

    const buttons: HTMLElement[] = [];
    for (const one of FREE_LOOKS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = one.label;
      button.dataset.look = one.id;
      if ((mine?.look ?? "") === one.id) button.setAttribute("aria-pressed", "true");
      button.addEventListener("click", () => {
        for (const other of buttons) other.removeAttribute("aria-pressed");
        button.setAttribute("aria-pressed", "true");
        tell({ kind: "姿を変える", look: one.id });
      });
      buttons.push(button);
    }
    rack.append(...buttons);
    return rack;
  }

  /** 置いてある物の控え。**片付けるときに、どれが自分のかを知るのに要る。** */
  const placed = new Map<string, Item>();

  /** 扉。**押した先が実在することはサーバが保証している**（zones.ts の検査）。 */
  function showDoors(exits: Door[]): void {
  doors.replaceChildren(
    ...exits.map((exit) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${exit.title} へ`;
      // **頁を読み直さない。** 読み直すと Hub の他の画面まで捨てることになり、
      // 資産も一から読み直しになる。繋ぎ直すだけで済む。
      button.addEventListener("click", () => { void enter(exit.id); });
      return button;
    })
  );
  }

  /**
 * 発言を出す。
 *
 * **名前も本文も、他人が書いた文字列。** textContent で入れる。innerHTML に
 * したら、発言で画面を書き換えられる。
 */
  function say(name: string, text: string): void {
  const row = document.createElement("li");
  const who = document.createElement("b");
  who.textContent = name;
  row.append(who, document.createTextNode(text));
  log.append(row);
  // 溜め続けると重くなる。古いものから捨てる。
  while (log.childElementCount > 60) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
  }

  const onSay = (event: Event) => {
  event.preventDefault();
  const text = line.value.trim();
  if (!text || !connected()) return;
  tell({ kind: "話す", text });
  line.value = "";
  };
  sayForm.addEventListener("submit", onSay);

  // 入力中は歩かない。**話そうとして走り出すと、書けない。**
  const onLineFocus = () => held.clear();
  line.addEventListener("focus", onLineFocus);

  /** 押されている向き。押した瞬間ではなく、押している間ずっと進む。 */
  const held = new Set<string>();
  const onKeyDown = (event: KeyboardEvent) => {
    if (document.activeElement !== canvas) return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;
    event.preventDefault();
    held.add(key);
  };
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.key.toLowerCase());
  const onBlur = () => held.clear();
  addEventListener("keydown", onKeyDown);
  addEventListener("keyup", onKeyUp);
  addEventListener("blur", onBlur);
  canvas.addEventListener("blur", onBlur);
  const controls = stage.controls;
  if (controls) {
    const directions = [["w", "↑", "前へ"], ["a", "←", "左へ"], ["s", "↓", "後ろへ"], ["d", "→", "右へ"]];
    controls.replaceChildren(...directions.map(([key, symbol, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = symbol!;
      button.setAttribute("aria-label", label!);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        held.add(key!);
      });
      const stop = () => held.delete(key!);
      button.addEventListener("pointerup", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("lostpointercapture", stop);
      button.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); held.add(key!); }
      });
      button.addEventListener("keyup", stop);
      button.addEventListener("blur", stop);
      return button;
    }));
  }

  /**
 * 区画は接続そのものが表す。**移るときは入り直す。**
 *
 * 一本の接続で区画を跨ぐこともできるが、そうすると「今どこに居るか」を
 * 客とサーバの両方が憶えることになり、食い違ったときに直せない。入り直せば、
 * 居る場所は常に接続そのものが表す。
 */
  const here = new URLSearchParams(location.search);
  const zoneAtStart = options.zone ?? here.get("zone") ?? "city";

  /**
 * 入る許可をもらう。
 *
 * **署名するのは口座の側だけ。** 他のサービス（ai / music / commerce）も同じで、
 * 受け取る側は検めるだけ。ここが鍵を持つと、世界が破られたときに口座まで破られる。
 *
 * 取れなければ、許可なしで繋ぐ——**稽古の形（127.0.0.1）でだけ通る。**
 * 外向きのサーバは許可の無い接続を断る。
 */
  async function askForPass(isCurrent: () => boolean): Promise<string | null> {
    // **宛先はサーバごと。** 名乗らなければ、この台の世界として扱われる。
    const body = JSON.stringify(options.server ? { server: options.server } : {});
    const send = (path: string) => fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body
    });
    const ask = () => send("/account/api/v1/assertions/hub-world");
    try {
      let answer = await ask();
      if (!isCurrent()) return null;
      /*
       * **初めての人は、まだ結びついていない。** 口座は宛先ごとに別の識別子を
       * 持つ作りなので、この世界の分を一度こしらえる必要がある（403 が
       * hub_world_link_required）。他のサービスと同じ作法で、結んでから取り直す。
       *
       * 実測で、ここが無いまま「世界との繋がりが切れました」とだけ出ていた
       * ——画面には理由が出ないので、原因が分からなかった。
       */
      if (answer.status === 403) {
        const linked = await send("/account/api/v1/links/hub-world");
        if (!isCurrent()) return null;
        if (!linked.ok) {
          /*
           * **403 は「古い session では結べない」。** 口座に新しい結び付きを
           * 作る操作なので、ログインから10分以内でなければ通らない
           * （services/account の recentlyAuthenticated）。
           *
           * ここを「もう一度ログインしてください」とだけ書いていたので、
           * ログインしてから時間を置いた人が同じ所で止まった。**制限を言う。**
           */
          if (isCurrent()) banner.textContent = linked.status === 403
            ? "ログインし直して、10分以内にもう一度開いてください"
            : "この世界と口座を結べませんでした";
          return null;
        }
        answer = await ask();
        if (!isCurrent()) return null;
      }
      if (!answer.ok) {
        // **理由を画面に出す。** 出さないと、繋がらない理由が誰にも分からない。
        if (isCurrent()) banner.textContent = answer.status === 401
          ? "Hub にログインしてから開いてください"
          : "入る許可をもらえませんでした";
        return null;
      }
      const body = await answer.json() as { assertion?: unknown };
      return typeof body.assertion === "string" ? body.assertion : null;
    } catch {
      if (isCurrent()) banner.textContent = "口座に繋がりません";
      return null;
    }
  }

  /**
 * 世界のつなぎ先。
 *
 * **本番では前段を通す。** 世界のサーバは 127.0.0.1 で待っていて、外を向くのは
 * 証明書を持つ前段だけ。港へ直に繋ぐと、裸のまま外に出ることになる。
 *
 * 手元では前段が無いので、直に繋ぐ。
 */
  function worldAddress(zone: string, pass: string | null): string {
    const query = `?zone=${encodeURIComponent(zone)}`
      + (pass ? `&pass=${encodeURIComponent(pass)}` : "");
    if (options.address) {
      const mark = options.address.includes("?") ? "&" : "?";
      return options.address + mark + query.slice(1);
    }
    // **既定は、今開いている場所。** 区画は Hub の中にあるので、外を指す理由が
    // 無い。同じ生い立ちなので、CORS も別の名前も証明書も要らない。
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/world/live${query}`;
  }

  /**
 * **トップレベルで await しない。**
 *
 * 許可をもらってから繋ぎたいので await したくなるが、対象のブラウザ
 * （safari14 など）では使えず、ビルドがそこで落ちる。**手元では動いて、
 * 配る段になって落ちる**種類の間違い。
 *
 * 繋ぐのは非同期の中で行い、外からは「まだ繋がっていないかもしれない」
 * ものとして扱う。
 */
  let socket: WebSocket | null = null;
  const retryGate = createConnectionRetryGate();

  function connected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
  }

  function tell(message: unknown): void {
  if (connected()) socket!.send(JSON.stringify(message));
  }



  // **文字でも塊でも受ける。** ブラウザは実装によって Blob で渡してくる
  // （実測で `[object Blob]` を JSON にしようとして落ちた）。

  async function readFrame(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
  }

  async function receive(event: MessageEvent): Promise<void> {
  const receivedAttempt = attempt;
  let message: { kind?: string; [key: string]: unknown };
  try {
    message = JSON.parse(await readFrame(event.data));
    if (closed || receivedAttempt !== attempt) return;
  } catch {
    // 読めないものは捨てる。落とさない。
    return;
  }
  if (message.kind === "ここ") {
    me = typeof message.you === "string" ? message.you : null;
    style = message.style as Style;
    banner.textContent = `${message.title}（${message.style}）`;
    const radius = typeof message.radius === "number" ? message.radius : 60;
    const currentAttempt = attempt;
    const refreshStreet = () => {
      if (closed || currentAttempt !== attempt) return;
      atmosphere.refreshWater();
      for (const mesh of scene.meshes) if (mesh.metadata?.castShadow) shadows.addShadowCaster(mesh);
    };
    void loadZone(scene, String(message.zone ?? "city"), style, radius, assets, typeof message.layout === "string" ? message.layout : undefined, refreshStreet).then((carved) => {
      if (!closed && currentAttempt === attempt && !carved) banner.textContent = "このサーバーは新しいワールド形式に対応していません";
      refreshStreet();
    });
    showDoors(Array.isArray(message.exits) ? (message.exits as Door[]) : []);
    // **読めたかどうかを画面に出す。** 黙ってカプセルに落ちると、資産が
    // 無いのか読めないのかが分からない（街並みで同じことをして分からなくなった）。
    void (thingsLoading ??= loadThings(scene, assets));
    return;
  }
  if (message.kind === "置いてある物") {
    // **サーバが配った並びだけを出す。** 押した瞬間に足すと、断られたときに
    // 幽霊が残る（置けなかったのに見えている、という状態になる）。
    const items = (message.items ?? []) as Item[];
    showThings(scene, things, items, assets);
    for (const item of things.values()) {
      for (const mesh of item.root?.getChildMeshes() ?? []) { mesh.receiveShadows = true; shadows.addShadowCaster(mesh); }
    }
    placed.clear();
    for (const one of items) placed.set(one.id, one);
  }
  if (message.kind === "居る人") show(message.avatars as Watcher[]);
  if (message.kind === "発言") {
    say(String(message.name ?? ""), String(message.text ?? ""));
  }
  if (message.kind === "断り") banner.textContent = `断られた: ${message.reason}`;
  }

  /**
 * 意思を送る。
 *
 * **画面の速さで送らない。** 60回/秒で送ってもサーバは受け付けないし、
 * 通信が太るだけ。上限に合わせて間引く。
 */
  let sentAt = 0;
  scene.onBeforeRenderObservable.add(() => {
  if (!mine || !connected()) return;
  const now = performance.now();
  if (now - sentAt < 50) return;
  const elapsed = Math.min(now - sentAt, 100);
  sentAt = now;

  // 進む向きは画面の向きに合わせる。カメラの後ろが「奥」。
  const forward = (held.has("w") || held.has("arrowup") ? 1 : 0) - (held.has("s") || held.has("arrowdown") ? 1 : 0);
  const side = (held.has("d") || held.has("arrowright") ? 1 : 0) - (held.has("a") || held.has("arrowleft") ? 1 : 0);
  if (forward === 0 && side === 0) return;

  const { x: dx, z: dz } = movement(camera.alpha, forward, side, LIMITS.speed * elapsed / 1000);
  tell({
    kind: "動く",
    x: mine.x + dx,
    z: mine.z + dz,
    facing: Math.atan2(dx, dz)
  });
  });

  /**
 * 生存の便り。
 *
 * **立ち止まっている人も、世界には居る。** これが無いと、広場に立って話を
 * 聞いているだけの人が幽霊として片付けられる（実測で名簿から消えた）。
 */
  const heartbeat = setInterval(() => tell({ kind: "居る" }), 20_000);

  /** 名乗り。一度決めたら、区画を移っても変えない。 */
  const myName = options.name ?? here.get("name")
    ?? `旅人${Math.floor(Math.random() * 900 + 100)}`;

  /** 世界を閉じたかどうか。**閉じた後に繋がれても困る。** */
  let closed = false;

  /**
   * 何度目の入り直しか。
   *
   * **扉は続けて押せる。** 許可をもらう間に次の扉が押されると、遅れて返って
   * きた古い方が後から繋ぎ、押した先とは違う区画に立つ。番号で、追い越された
   * 方を捨てる。
   */
  let attempt = 0;

  function showReconnect(): void {
    const zone = retryGate.zone();
    if (!zone || closed) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "もう一度接続する";
    button.addEventListener("click", () => { void enter(zone); });
    doors.replaceChildren(button);
  }

  /**
   * 繋ぐ。許可をもらってから。
   *
   * 区画を移るときも、これを呼び直す。
   */
  async function enter(zone: string): Promise<void> {
    if (closed) return;
    const retry = retryGate.start(zone);
    if (!retry) return;
    const mine = (attempt += 1);

    // **先に古い方を黙らせる。** 閉じる合図が後から届いて「切れました」と
    // 出るのを防ぐ。
    const old = socket;
    socket = null;
    old?.close();

    // 人も台詞も、区画ごと。持ち越すと、居ない人が立ったままになる。
    show([]);
    held.clear();
    log.replaceChildren();
    placed.clear();
    for (const made of things.values()) { made.sign?.dispose(); made.root?.dispose(false, false); }
    things.clear();
    doors.replaceChildren();

    banner.textContent = "世界へ繋いでいます";
    const isCurrent = () => !closed && mine === attempt && retryGate.isCurrent(retry);
    const pass = await askForPass(isCurrent);
    if (!isCurrent()) return;

    let opened: WebSocket;
    try {
      opened = new WebSocket(worldAddress(zone, pass));
    } catch {
      retryGate.finish(retry);
      banner.textContent = "世界との繋がりを始められませんでした";
      showReconnect();
      return;
    }
    opened.binaryType = "arraybuffer";
    opened.addEventListener("open", () => {
      if (socket !== opened || closed || !retryGate.isCurrent(retry)) return;
      retryGate.finish(retry);
      opened.send(JSON.stringify({ kind: "入る", name: myName }));
    });
    opened.addEventListener("message", (event) => { if (socket === opened && !closed) void receive(event); });
    opened.addEventListener("close", () => {
      // **今の接続が切れたときだけ言う。** 移り変わりの最中の古い接続は黙って消える。
      if (socket === opened && !closed) {
        socket = null;
        retryGate.finish(retry);
        banner.textContent = "世界との繋がりが切れました";
        showReconnect();
      }
    });
    socket = opened;
  }

  showShelf();

  void enter(zoneAtStart);

  engine.runRenderLoop(() => {
    const delta = Math.min(engine.getDeltaTime() / 1000, 0.05);
    atmosphere.update(delta);
    const now = performance.now();
    for (const [id, person] of people) {
      person.walking = now - (lastMotion.get(id) ?? -Infinity) < 150;
      person.update(delta);
    }
    scene.render();
  });

  /**
   * 絵の大きさを、置かれた枠に合わせる。
   *
   * **窓の大きさだけでは足りない。** Hub の中では、横の欄が開け閉めされたり、
   * 頁の作りが変わったりして、窓は同じまま枠だけが変わる。実測で、最初の一枚が
   * 300x150 のまま（Babylon の既定）描かれていた。枠そのものを見る。
   */
  const watchSize = new ResizeObserver(() => engine.resize());
  watchSize.observe(canvas);
  const onResizeWindow = () => engine.resize();
  addEventListener("resize", onResizeWindow);

  /**
   * 閉じる。**頁を移ったら、全部やめる。**
   *
   * 返さないと、描き続け、繋ぎっぱなしになり、鍵の入力も拾い続ける。
   * Hub のような頁を移る作りの中では、これが無いと必ず漏れる。
   */
  return () => {
    closed = true;
    retryGate.dispose();
    clearInterval(heartbeat);
    watchSize.disconnect();
    removeEventListener("resize", onResizeWindow);
    removeEventListener("keydown", onKeyDown);
    removeEventListener("keyup", onKeyUp);
    removeEventListener("blur", onBlur);
    canvas.removeEventListener("blur", onBlur);
    sayForm.removeEventListener("submit", onSay);
    line.removeEventListener("focus", onLineFocus);
    controls?.replaceChildren();
    try { socket?.close(); } catch { /* 既に閉じている */ }
    for (const made of things.values()) { made.sign?.dispose(); made.root?.dispose(false, false); }
    things.clear();
    engine.stopRenderLoop();
    atmosphere.dispose();
    for (const person of people.values()) person.drop();
    people.clear();
    scene.dispose();
    engine.dispose();
  };
}
