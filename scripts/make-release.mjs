// LOCAL-FIRST (owner order 2026-10-02): "the COMPLETE software is downloaded to the user's laptop as ONE versioned bundle
// (version number, download date, every file with a number and a version, matched with the backend)".
//
// This script runs after `next build` and turns the build output into the release the laptop installs
// (docs/local-first/CONTRACT.md section 3):
//
//   public/_release/release.json                 the manifest: version, git sha, every file with its size and sha256, the digest of all of it
//   public/_release/px-<release_version>.tar.gz  ONE file holding every static asset, like an image
//
// WHAT GOES IN THE BUNDLE
//   * every file of .next/static/**   served at /_next/static/**  (the code, CSS, fonts of this build)
//   * every file of public/**         served at /**              (icons, logo, manifest assets), except public/_release itself
//   * the prerendered shell page /local, when the build produced it (.next/server/app/local.html), stored as _shell/local.html.
//     The laptop caches it under /local so the shell and the code it loads always come from the SAME build.
//
// MANIFEST DIGEST. manifest_sha256 = sha256 of the canonical JSON of the manifest WITHOUT manifest_sha256. Canonical JSON =
// JSON with object keys sorted at every level (arrays keep their order, `undefined` members are dropped). The same function is
// in src/lib/local-first/release/canonical.ts and in the backend; the fixed vector from CONTRACT.md is asserted in
// src/lib/local-first/release/canonical.test.ts (this file's copy is checked against it too).
//
// WHY A HAND-WRITTEN TAR. The bundle must be byte-for-byte the same for the same inputs (so its sha256 means something), and
// the laptop reads it with a ~60 line reader in the browser (src/lib/local-first/release/bundle.ts). A deterministic ustar
// writer is shorter and safer than a dependency: fixed mtime 0, owner 0, mode 0644, entries sorted by path, and the gzip
// header's OS byte pinned, so a Windows and a Linux build of the same files produce the same bytes.
//
// HARMLESS WHEN IT HAS NOTHING TO DO. No .next/static and no public/ -> prints why and exits 0. With --postbuild a real error
// is also only a warning (a release bundle must never be the reason a deploy fails); `bun run release:build` is the strict form.
//
// Usage:  node scripts/make-release.mjs [--root <dir>] [--postbuild]
// Env:    BUILD_NUMBER (the NNN of the version), VERCEL_GIT_COMMIT_SHA / GITHUB_SHA (git_sha, and the NNN when BUILD_NUMBER is unset)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const PROTOCOL_VERSION = 2;
export const RELEASE_DIR = "_release";
export const SHELL_FILE_PATH = "_shell/local.html";
const SHELL_CANDIDATES = [".next/server/app/local.html", ".next/server/app/local/index.html"];

// ─── canonical JSON (same rules as src/lib/local-first/release/canonical.ts) ─────────────────────────────

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(",")}}`;
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

// ─── the version ────────────────────────────────────────────────────────────────────────────────

/** YYYY.MM.DD-NNN. NNN is BUILD_NUMBER when given, else a number derived from the commit sha, else 000. */
export function releaseVersion({ date, buildNumber, sha }) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  let n = 0;
  if (buildNumber !== undefined && buildNumber !== "" && /^\d+$/.test(String(buildNumber))) {
    n = Number(buildNumber) % 1000;
  } else if (sha && /^[0-9a-f]{6,}$/i.test(sha)) {
    n = parseInt(sha.slice(0, 6), 16) % 1000;
  }
  return `${y}.${m}.${d}-${String(n).padStart(3, "0")}`;
}

// ─── the files ──────────────────────────────────────────────────────────────────────────────────

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push({ path: relative(base, full).split(sep).join("/"), full });
  }
  return out;
}

/** Every file that goes in the release: [{ path, bytes }], sorted by path. */
export function collectFiles(root) {
  const files = new Map();
  const staticDir = join(root, ".next", "static");
  if (existsSync(staticDir)) {
    for (const f of walk(staticDir)) files.set(`_next/static/${f.path}`, f.full);
  }
  const publicDir = join(root, "public");
  if (existsSync(publicDir)) {
    for (const f of walk(publicDir)) {
      if (f.path === RELEASE_DIR || f.path.startsWith(`${RELEASE_DIR}/`)) continue; // never the release's own output
      if (f.path.endsWith(".DS_Store")) continue;
      files.set(f.path, f.full);
    }
  }
  for (const candidate of SHELL_CANDIDATES) {
    const full = join(root, ...candidate.split("/"));
    if (existsSync(full) && statSync(full).isFile()) {
      files.set(SHELL_FILE_PATH, full);
      break;
    }
  }
  return [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, full]) => ({ path, bytes: readFileSync(full) }));
}

// ─── the tar ────────────────────────────────────────────────────────────────────────────────────

const BLOCK = 512;

function putString(buf, offset, length, text) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > length) throw new Error(`tar field overflow: "${text}"`);
  bytes.copy(buf, offset);
}

function putOctal(buf, offset, length, value) {
  const digits = value.toString(8);
  if (digits.length > length - 1) throw new Error(`tar number overflow: ${value}`);
  putString(buf, offset, length, `${digits.padStart(length - 1, "0")}\0`);
}

function splitName(path) {
  const total = Buffer.byteLength(path, "utf8");
  if (total <= 100) return { name: path, prefix: "" };
  // ustar: up to 155 bytes of directory prefix + up to 100 bytes of name, split at a "/".
  for (let i = path.length - 1; i > 0; i -= 1) {
    if (path[i] !== "/") continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) return { name, prefix };
  }
  throw new Error(`The release cannot hold this path (longer than a ustar tar allows): ${path}`);
}

/** A deterministic ustar archive of [{ path, bytes }]. */
export function makeTar(entries) {
  const parts = [];
  for (const { path, bytes } of entries) {
    const header = Buffer.alloc(BLOCK);
    const { name, prefix } = splitName(path);
    putString(header, 0, 100, name);
    putOctal(header, 100, 8, 0o644);
    putOctal(header, 108, 8, 0);
    putOctal(header, 116, 8, 0);
    putOctal(header, 124, 12, bytes.length);
    putOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156); // the checksum is computed with this field read as spaces
    header[156] = 0x30; // "0": a regular file
    putString(header, 257, 6, "ustar\0");
    putString(header, 263, 2, "00");
    putString(header, 345, 155, prefix);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i];
    putString(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    parts.push(header, Buffer.from(bytes));
    const pad = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/** gzip with a fixed header: mtime 0 (Node's default) and the OS byte pinned to 3 (Unix), so the bytes do not depend on the machine. */
export function gzipDeterministic(bytes) {
  const gz = gzipSync(bytes, { level: 9 });
  gz[4] = 0;
  gz[5] = 0;
  gz[6] = 0;
  gz[7] = 0; // mtime
  gz[9] = 3; // OS
  return gz;
}

// ─── the release ────────────────────────────────────────────────────────────────────────────────

/** Reads `export const LOCAL_DB_VERSION = N` from the local database module; that is the "schema" of the manifest. */
export function readLocalDbVersion(root) {
  const file = join(root, "src", "lib", "local-first", "local-db.ts");
  if (!existsSync(file)) throw new Error(`Cannot read the local database version: ${file} does not exist`);
  const match = /export\s+const\s+LOCAL_DB_VERSION\s*=\s*(\d+)/.exec(readFileSync(file, "utf8"));
  if (!match) throw new Error(`Cannot find "export const LOCAL_DB_VERSION = <number>" in ${file}`);
  return Number(match[1]);
}

/**
 * Builds the release into <root>/public/_release. Returns { skipped: true, reason } when there is nothing to build from,
 * otherwise { skipped: false, manifest, dir }.
 */
export function buildRelease({ root, env = process.env, now = new Date(), log = () => {} }) {
  if (!existsSync(join(root, ".next", "static")) && !existsSync(join(root, "public"))) {
    return { skipped: true, reason: "neither .next/static nor public/ exists: nothing to put in a release" };
  }
  const files = collectFiles(root);
  if (files.length === 0) return { skipped: true, reason: ".next/static and public/ hold no files: nothing to put in a release" };

  const sha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || "";
  const version = releaseVersion({ date: now, buildNumber: env.BUILD_NUMBER, sha });
  const bundleBytes = gzipDeterministic(makeTar(files));
  const dir = join(root, "public", RELEASE_DIR);
  const bundlePath = `${RELEASE_DIR}/px-${version}.tar.gz`;

  const body = {
    release_version: version,
    git_sha: sha || null,
    built_at: now.toISOString(),
    protocol: PROTOCOL_VERSION,
    schema: readLocalDbVersion(root),
    bundle: { path: bundlePath, size: bundleBytes.length, sha256: sha256Hex(bundleBytes) },
    files: files.map((f) => ({ path: f.path, size: f.bytes.length, sha256: sha256Hex(f.bytes) })),
  };
  const manifest = { ...body, manifest_sha256: sha256Hex(canonicalJson(body)) };

  // Only the newest release stays: an older bundle is dead weight in every deployment.
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (entry === "release.json" || /^px-.+\.tar\.gz$/.test(entry)) rmSync(join(dir, entry), { force: true });
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `px-${version}.tar.gz`), bundleBytes);
  writeFileSync(join(dir, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`release ${version}: ${files.length} files, bundle ${bundleBytes.length} bytes, manifest ${manifest.manifest_sha256.slice(0, 12)}`);
  return { skipped: false, manifest, dir };
}

// ─── command line ───────────────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2), env = process.env) {
  const postbuild = argv.includes("--postbuild");
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : process.cwd();
  try {
    const result = buildRelease({ root, env, log: (line) => console.log(`[release] ${line}`) });
    if (result.skipped) console.log(`[release] skipped: ${result.reason}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (postbuild) {
      console.warn(`[release] WARNING: the release bundle was not built (${message}). The build itself is fine.`);
      return 0;
    }
    console.error(`[release] FAILED: ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
