import { forwardWebFinger } from "@/lib/server/federation-webfinger";

/*
 * WebFinger の実体は apps/federation にある（actor は /users/{handle}）。
 * ここは Federation へ回されなかった場合の保険で、Hub 自身は actor を作らない。
 */
export async function GET(request: Request) {
  return forwardWebFinger(request.url, process.env.FEDERATION_SERVICE_URL);
}
