import type { R2ObjectBody } from "@cloudflare/workers-types";

/**
 * Bridges the Workers R2 stream type to the DOM stream type used by Next.js
 * without buffering the complete object in Worker memory.
 */
export function r2ResponseStream(source: R2ObjectBody["body"]): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
