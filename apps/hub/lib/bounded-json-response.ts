export async function readBoundedJsonResponse(
  response: Response,
  maximumBytes = 65_536,
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1_048_576)
    throw new Error("bounded_json_limit_invalid");
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maximumBytes)
    throw new Error("bounded_json_response_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("bounded_json_body_unavailable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("bounded_json_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
