import { DurableObject } from "cloudflare:workers";

import { validateFeedRealtimeUpgrade, type FeedRealtimeEvent } from "@/lib/feed-realtime";

export class FeedRealtimeShard extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  fetch(request: Request): Response {
    const upgradeError = validateFeedRealtimeUpgrade(request);
    if (upgradeError) return new Response(upgradeError.message, { status: upgradeError.status });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["public-feed"]);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  broadcastNewPost(event: FeedRealtimeEvent): number {
    const message = JSON.stringify(event);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets("public-feed")) {
      try { socket.send(message); delivered += 1; } catch { /* Stale sockets are discarded by the runtime. */ }
    }
    return delivered;
  }

  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Server-push only");
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "WebSocket error");
  }
}
