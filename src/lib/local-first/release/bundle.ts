// LOCAL-FIRST release: reads the ONE bundle file (px-<release_version>.tar.gz) the build produced
// (scripts/make-release.mjs). Two small jobs, no dependencies:
//   gunzip(bytes)  the browser's own DecompressionStream
//   readTar(bytes) a minimal ustar reader: regular files, a long path in the ustar `prefix` field, PAX "path" records and GNU
//                  long names. Directories and anything else are skipped.
//
// The bytes are NOT trusted: every header checksum is verified, a name that could escape its place ("..", a leading "/", a
// backslash) is refused, and a size that runs past the end of the data is refused. The installer additionally verifies the
// sha256 of the whole bundle and of every file against the manifest before it writes anything.

export type TarEntry = { path: string; bytes: Uint8Array };

const BLOCK = 512;
const decoder = new TextDecoder();

/** A gunzip implementation; the default uses the platform's DecompressionStream. Injected in tests of the installer. */
export type Gunzip = (bytes: Uint8Array) => Promise<Uint8Array>;

export const gunzip: Gunzip = async (bytes) => {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack the PROJEXA bundle (no DecompressionStream).");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

function cString(block: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && block[end] !== 0) end += 1;
  return decoder.decode(block.subarray(start, end));
}

function octal(block: Uint8Array, start: number, length: number): number {
  const text = cString(block, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error("The PROJEXA bundle is damaged (a size or checksum field is not a number).");
  return parseInt(text, 8);
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < BLOCK; i += 1) if (block[i] !== 0) return false;
  return true;
}

function checksumOk(block: Uint8Array): boolean {
  const stored = octal(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
  return sum === stored;
}

/** Throws unless `path` is a plain relative path with no "." / ".." segment, no backslash and no NUL. */
export function assertSafePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`The PROJEXA bundle names a file it must not (${JSON.stringify(path)}).`);
  }
}

function paxRecords(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    let space = offset;
    while (space < data.length && data[space] !== 0x20) space += 1;
    const length = parseInt(decoder.decode(data.subarray(offset, space)), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > data.length) break;
    const record = decoder.decode(data.subarray(space + 1, offset + length - 1)); // key=value, without the trailing newline
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    offset += length;
  }
  return out;
}

/** The regular files of an uncompressed tar, in archive order. */
export function readTar(tar: Uint8Array, options: { maxFiles?: number } = {}): TarEntry[] {
  const maxFiles = options.maxFiles ?? 50_000;
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingPath: string | null = null;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break;
    if (!checksumOk(header)) throw new Error("The PROJEXA bundle is damaged (a file header failed its checksum).");

    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error("The PROJEXA bundle is damaged (a file is cut short).");
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      pendingPath = paxRecords(data).get("path") ?? pendingPath;
      continue;
    }
    if (type === "L") {
      pendingPath = cString(data, 0, data.length);
      continue;
    }
    if (type === "g") continue; // a global PAX header names nothing

    const name = cString(header, 0, 100);
    const prefix = cString(header, 345, 155);
    const path = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = null;

    if (type !== "0") continue; // directories, links, devices: not part of a PROJEXA release
    assertSafePath(path);
    if (entries.length >= maxFiles) throw new Error("The PROJEXA bundle holds more files than a release can.");
    entries.push({ path, bytes: data });
  }
  return entries;
}

/** gunzip + readTar. */
export async function readBundle(gz: Uint8Array, unzip: Gunzip = gunzip): Promise<TarEntry[]> {
  return readTar(await unzip(gz));
}
