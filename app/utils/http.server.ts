/**
 * Reads and JSON-parses a request body while enforcing a hard byte cap —
 * checking the Content-Length header alone isn't enough, since a caller
 * can omit it (chunked transfer) or lie about it; only counting bytes as
 * they actually arrive is trustworthy. Used on public, unauthenticated
 * routes where a caller could otherwise stream an unbounded body at us and
 * exhaust memory before we ever get to validate anything about it.
 */
export class PayloadTooLargeError extends Error {}

export async function readJsonWithLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    return {};
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}
