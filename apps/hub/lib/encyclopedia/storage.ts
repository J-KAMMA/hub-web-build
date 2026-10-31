import "server-only";

import { getHubMedia } from "@/lib/server/hub-d1";

export interface ObjectStore {
  put(content: Uint8Array, contentType: string): Promise<string>;
}

export class R2ObjectStore implements ObjectStore {
  async put(content: Uint8Array, contentType: string) {
    const key = `encyclopedia/raw/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`;
    await getHubMedia().put(key, content, {
      httpMetadata: { contentType }
    });
    return key;
  }
}
