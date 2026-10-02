// LOCAL-FIRST release: canonical JSON and sha256, the SAME rules as the backend and as scripts/make-release.mjs
// (docs/local-first/CONTRACT.md section 1). Canonical JSON = JSON with object keys sorted at every level, arrays keep
// their order, `undefined` members are dropped (an `undefined` array slot is written as null, like JSON.stringify does).
// A release's manifest_sha256 is the sha256 of the canonical JSON of the manifest without manifest_sha256.
//
// Browser, service worker and Node alike: only WebCrypto, no imports.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export type Bytes = Uint8Array | ArrayBuffer;

function toBuffer(data: string | Bytes): ArrayBuffer {
  if (typeof data === "string") {
    const encoded = new TextEncoder().encode(data);
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  }
  if (data instanceof Uint8Array) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return data;
}

/** Lower-case hex sha256 of a string (UTF-8) or of bytes. */
export async function sha256Hex(data: string | Bytes): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toBuffer(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
