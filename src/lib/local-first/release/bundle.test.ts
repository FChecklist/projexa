import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { makeTar } from "../../../../scripts/make-release.mjs";
import { assertSafePath, gunzip, readBundle, readTar } from "./bundle";

const enc = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** A tar header written by hand, for the cases the build script never produces (PAX, GNU long name, odd types). */
function header(name: string, size: number, type = "0", prefix = ""): Uint8Array {
  const h = new Uint8Array(512);
  const put = (offset: number, value: string) => h.set(enc(value), offset);
  put(0, name);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, `${size.toString(8).padStart(11, "0")}\0`);
  put(136, "00000000000\0");
  h.fill(0x20, 148, 156);
  put(156, type);
  put(257, "ustar\0");
  put(263, "00");
  put(345, prefix);
  let sum = 0;
  for (const byte of h) sum += byte;
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return h;
}

function block(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  padded.set(bytes);
  return padded;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const END = new Uint8Array(1024);

describe("bundle: gunzip and the tar reader", () => {
  test("a gzip'd tar written by the build script is read back, bytes and order intact", async () => {
    const files = [
      { path: "a.txt", bytes: enc("hello") },
      { path: "dir/b.bin", bytes: new Uint8Array([0, 255, 7]) },
      { path: "empty", bytes: new Uint8Array(0) },
      { path: "exact-block", bytes: new Uint8Array(512).fill(9) },
    ];
    const entries = await readBundle(new Uint8Array(gzipSync(makeTar(files))));
    expect(entries.map((e) => e.path)).toEqual(files.map((f) => f.path));
    expect([...entries[1]!.bytes]).toEqual([0, 255, 7]);
    expect(entries[2]!.bytes.length).toBe(0);
    expect(entries[3]!.bytes.length).toBe(512);
    expect(text(entries[0]!.bytes)).toBe("hello");
  });

  test("gunzip really decompresses and rejects non-gzip bytes", async () => {
    expect(text(await gunzip(new Uint8Array(gzipSync(Buffer.from("plain text")))))).toBe("plain text");
    await expect(gunzip(enc("this is not gzip"))).rejects.toThrow();
  });

  test("a long path stored with the ustar prefix field is joined back together", () => {
    const tar = concat(header("file.js", 3, "0", "a/very/deep/dir"), block(enc("abc")), END);
    expect(readTar(tar).map((e) => e.path)).toEqual(["a/very/deep/dir/file.js"]);
  });

  test("a PAX path record names the next file", () => {
    // A PAX record is "<length> <key>=<value>\n" where <length> counts the whole record, its own digits included.
    const body = enc(`${"path=pax/named/file-long.js".length + 1 + 3} path=pax/named/file-long.js\n`);
    expect(body.length).toBe(31);
    const tar = concat(header("PaxHeader", body.length, "x"), block(body), header("ignored-short-name", 2, "0"), block(enc("hi")), END);
    const entries = readTar(tar);
    expect(entries.map((e) => e.path)).toEqual(["pax/named/file-long.js"]);
    expect(text(entries[0]!.bytes)).toBe("hi");
  });

  test("a GNU long-name entry names the next file", () => {
    const longName = enc("gnu/long/name/file.css\0");
    const tar = concat(header("././@LongLink", longName.length, "L"), block(longName), header("short", 1, "0"), block(enc("z")), END);
    expect(readTar(tar).map((e) => e.path)).toEqual(["gnu/long/name/file.css"]);
  });

  test("directories and other entry types are skipped, only regular files are returned", () => {
    const tar = concat(header("somedir/", 0, "5"), header("link", 0, "2"), header("somedir/real.txt", 2, "0"), block(enc("ok")), END);
    expect(readTar(tar).map((e) => e.path)).toEqual(["somedir/real.txt"]);
  });
});

describe("bundle: bytes that cannot be trusted", () => {
  test("a header whose checksum is wrong is refused", () => {
    const tar = new Uint8Array(concat(header("a.txt", 2), block(enc("hi")), END));
    tar[0] = tar[0]! ^ 0xff; // damage the name after the checksum was computed
    expect(() => readTar(tar)).toThrow(/checksum/);
  });

  test("a file whose data runs past the end is refused", () => {
    const tar = concat(header("big.bin", 4096), new Uint8Array(512));
    expect(() => readTar(tar)).toThrow(/cut short/);
  });

  test("names that could escape their place are refused", () => {
    for (const bad of ["../escape.js", "/abs/path.js", "a/../b.js", "back\\slash.js", "a//b.js", "./dot.js"]) {
      expect(() => assertSafePath(bad)).toThrow(/must not/);
      const tar = concat(header(bad, 1), block(enc("x")), END);
      expect(() => readTar(tar)).toThrow(/must not/);
    }
    expect(() => assertSafePath("_next/static/chunks/ok-123.js")).not.toThrow();
  });

  test("a bundle with more files than the limit is refused", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}`, bytes: enc("x") }));
    expect(() => readTar(makeTar(files), { maxFiles: 3 })).toThrow(/more files/);
    expect(readTar(makeTar(files), { maxFiles: 5 }).length).toBe(5);
  });

  test("a size field that is not an octal number is refused", () => {
    const h = header("a.txt", 2);
    h.set(enc("zzzzzzzzzzz\0"), 124);
    expect(() => readTar(concat(h, block(enc("hi")), END))).toThrow();
  });
});
