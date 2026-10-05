// AUDIT-100 B60: stages ONE verified PROJEXA release as the upload folder of the free Cloudflare Pages project that serves the
// app's static files (ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md). Nothing here talks to Cloudflare; the upload is
// `wrangler pages deploy <out>` afterwards.
//
// What it does, refusing at the first thing that does not verify (a static host must never serve bytes the laptops would refuse):
//   1. reads release.json (from --release-dir, default public/_release, or downloads it from --from <origin>) and checks its digest
//      (sha256 of the canonical JSON without manifest_sha256, the same rule as scripts/make-release.mjs);
//   2. reads the ONE bundle the manifest names and checks its size and sha256;
//   3. unpacks it and checks the bundle holds exactly the manifest's files, each with its listed size and sha256;
//   4. writes every file at the SAME path the app origin serves it at (/_next/static/**, public files), plus /_release/release.json
//      and /_release/<bundle> byte-for-byte, a _headers file (CORS + cache rules) and a 404.html (so a missing file is a real 404:
//      without one Cloudflare Pages answers every unknown path with the index page and status 200).
//   The prerendered shell (_shell/local.html) is an app PAGE, served by the app origin at /local: it is not staged.
//
// Because the files come out of the verified release, every staged byte equals what the release registry recorded for that release:
// the static host changes WHERE the files come from, never WHAT they are.
//
// Usage:  node scripts/stage-static-pages.mjs --out <dir> [--release-dir <dir> | --from <origin>]
// Prints one JSON line: { release_version, manifest_sha256, files, bytes, out }. Exit 1 on any refusal.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { canonicalJson } from "./make-release.mjs";

export const SHELL_FILE_PATH = "_shell/local.html";

/**
 * Cloudflare Pages `_headers` (https://developers.cloudflare.com/pages/configuration/headers/). Rules are applied in order and a
 * header set twice is JOINED with a comma, so each header is set once and `! Header` detaches an earlier value before a later rule
 * replaces it. Access-Control-Allow-Origin is `*`: the files are public build output, no request to this host carries credentials
 * (the installer fetches with credentials "omit"), and the app has more than one origin (projexa-ai.com, www, previews).
 */
export const HEADERS = `# AUDIT-100 B60 -- written by scripts/stage-static-pages.mjs; do not edit by hand.
/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
  Cache-Control: public, max-age=3600
/_next/static/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/_release/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/_release/release.json
  ! Cache-Control
  Cache-Control: no-cache
`;

export const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found.</p></body></html>\n`;

const HEX64 = /^[0-9a-f]{64}$/;
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class StageError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** Reads a ustar archive ([{ path, bytes }]); the same format scripts/make-release.mjs writes. */
export function readTar(tar) {
  const out = [];
  let offset = 0;
  const text = (start, length) => {
    const slice = tar.subarray(start, start + length);
    const end = slice.indexOf(0);
    return Buffer.from(end >= 0 ? slice.subarray(0, end) : slice).toString("utf8");
  };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = text(offset, 100);
    const prefix = text(offset + 345, 155);
    const size = parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const path = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512;
    if (!Number.isFinite(size) || start + size > tar.length) throw new StageError("bundle_unreadable", `the bundle's entry ${path} runs past its end`);
    if (type === "0" || type === "\0") out.push({ path, bytes: Buffer.from(tar.subarray(start, start + size)) });
    offset = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Checks a manifest's shape and own digest; returns it parsed. */
export function verifyManifest(manifestBytes) {
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch {
    throw new StageError("manifest_invalid", "release.json is not JSON");
  }
  if (!manifest || typeof manifest !== "object" || typeof manifest.release_version !== "string" || !HEX64.test(String(manifest.manifest_sha256))) {
    throw new StageError("manifest_invalid", "release.json lacks release_version / manifest_sha256");
  }
  if (!manifest.bundle || typeof manifest.bundle.path !== "string" || !/^_release\/px-[^/]+\.tar\.gz$/.test(manifest.bundle.path)) {
    throw new StageError("manifest_invalid", "release.json names no bundle under _release/");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new StageError("manifest_invalid", "release.json lists no files");
  const { manifest_sha256: claimed, ...body } = manifest;
  if (sha256Hex(canonicalJson(body)) !== claimed) throw new StageError("manifest_digest", "release.json does not match its own digest");
  for (const f of manifest.files) {
    if (typeof f.path !== "string" || f.path.startsWith("/") || f.path.split("/").some((seg) => seg === ".." || seg === "")) {
      throw new StageError("manifest_invalid", `unsafe file path ${JSON.stringify(f.path)}`);
    }
  }
  return manifest;
}

/**
 * Verifies the release and writes the upload folder. `outDir` is emptied first. Returns a summary.
 * manifestBytes / bundleBytes are the exact bytes that will be served (release.json is copied byte for byte).
 */
export function stageRelease({ manifestBytes, bundleBytes, outDir }) {
  const manifest = verifyManifest(manifestBytes);
  if (bundleBytes.length !== manifest.bundle.size || sha256Hex(bundleBytes) !== manifest.bundle.sha256) {
    throw new StageError("bundle_hash", `the bundle does not match the manifest (size ${bundleBytes.length} vs ${manifest.bundle.size}, or sha256)`);
  }
  let entries;
  try {
    entries = readTar(gunzipSync(bundleBytes));
  } catch (err) {
    if (err instanceof StageError) throw err;
    throw new StageError("bundle_unreadable", err instanceof Error ? err.message : String(err));
  }
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  const inBundle = new Map();
  for (const e of entries) {
    if (!listed.has(e.path)) throw new StageError("file_unexpected", `the bundle holds a file the manifest does not list: ${e.path}`);
    inBundle.set(e.path, e.bytes);
  }
  for (const f of manifest.files) {
    const bytes = inBundle.get(f.path);
    if (!bytes) throw new StageError("file_missing", `the bundle lacks ${f.path}`);
    if (bytes.length !== f.size || sha256Hex(bytes) !== f.sha256) throw new StageError("file_hash", `${f.path} does not match the manifest`);
  }

  const out = resolve(outDir);
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const write = (rel, bytes) => {
    const full = join(out, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  };
  let files = 0;
  let bytes = 0;
  for (const f of manifest.files) {
    if (f.path === SHELL_FILE_PATH) continue; // an app page, served by the app origin at /local
    if (f.path === "_headers" || f.path === "_redirects" || f.path === "_routes.json" || f.path === "404.html") {
      throw new StageError("file_reserved", `${f.path} is a Cloudflare Pages control file name; the release must not use it`);
    }
    write(f.path, inBundle.get(f.path));
    files += 1;
    bytes += f.size;
  }
  write("_release/release.json", Buffer.from(manifestBytes));
  write(manifest.bundle.path, Buffer.from(bundleBytes));
  write("_headers", Buffer.from(HEADERS, "utf8"));
  write("404.html", Buffer.from(NOT_FOUND_HTML, "utf8"));
  return { release_version: manifest.release_version, manifest_sha256: manifest.manifest_sha256, bundle: manifest.bundle.path, files, bytes, bundle_bytes: bundleBytes.length, out };
}

async function download(origin, path) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${origin.replace(/\/+$/, "")}${path}`, { cache: "no-store", credentials: "omit", headers: { "user-agent": "projexa-stage-static-pages" } });
      if (!res.ok) throw new Error(`${path} answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("unreachable");
}

export async function main(argv = process.argv.slice(2)) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const outDir = arg("out");
  if (!outDir) {
    console.error("usage: node scripts/stage-static-pages.mjs --out <dir> [--release-dir <dir> | --from <origin>]");
    return 2;
  }
  try {
    let manifestBytes;
    let bundleBytes;
    const from = arg("from");
    if (from) {
      manifestBytes = await download(from, "/_release/release.json");
      const manifest = verifyManifest(manifestBytes);
      bundleBytes = await download(from, `/${manifest.bundle.path}`);
    } else {
      const dir = arg("release-dir") ?? join(process.cwd(), "public", "_release");
      manifestBytes = readFileSync(join(dir, "release.json"));
      const manifest = verifyManifest(manifestBytes);
      bundleBytes = readFileSync(join(dir, manifest.bundle.path.slice("_release/".length)));
    }
    console.log(JSON.stringify(stageRelease({ manifestBytes, bundleBytes, outDir })));
    return 0;
  } catch (err) {
    console.error(`[stage-static-pages] REFUSED ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
