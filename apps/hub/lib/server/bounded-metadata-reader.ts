// External metadata only: cap bytes before decoding or growing the text buffer.
export async function readMetadataText(response: Response, maxBytes: 65536 | 131072): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("metadata_read_failed");
  try {
    if (Number(response.headers.get("content-length")) > maxBytes) throw new Error();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      if (value.byteLength > maxBytes - size) throw new Error();
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error("metadata_read_failed");
  } finally {
    reader.releaseLock();
  }
}
