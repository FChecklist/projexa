import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildRelease, canonicalJson, main, releaseVersion, SHELL_FILE_PATH } from "../../../../scripts/make-release.mjs";
import { canonicalJson as appCanonicalJson } from "./canonical";
import { gunzip, readTar } from "./bundle";

// Runs the REAL release script against a small fixture folder (no Next build): .next/static, public, the local database
// module it reads the schema number from, and optionally the prerendered shell page.

let root = "";
const NOW = new Date("2026-10-02T09:30:00.000Z");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function put(path: string, content: string | Uint8Array) {
  const full = join(root, ...path.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function fixture(extra: { shell?: boolean; schema?: string } = {}) {
  put(".next/static/chunks/app.js", "console.log('app');");
  put(".next/static/chunks/zeta.css", "body{color:red}");
  put(".next/static/media/font.woff2", new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]));
  put("public/logo-mark.svg", "<svg/>");
  put("public/icons/icon-192.png", new Uint8Array([137, 80, 78, 71]));
  put("public/_release/px-1999.01.01-001.tar.gz", "old bundle that must not be re-bundled or kept");
  put("public/_release/release.json", "{}");
  put("src/lib/local-first/local-db.ts", extra.schema ?? "export const LOCAL_DB_VERSION = 3;\n");
  if (extra.shell) put(".next/server/app/local.html", "<html>shell</html>");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "px-release-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("release script: the manifest", () => {
  test("version is date + BUILD_NUMBER zero-padded to three digits", () => {
    fixture();
    const result = buildRelease({ root, env: { BUILD_NUMBER: "7" }, now: NOW });
    expect(result.skipped).toBe(false);
    expect(result.manifest.release_version).toBe("2026.10.02-007");
    expect(releaseVersion({ date: NOW, buildNumber: "1234", sha: "" })).toBe("2026.10.02-234"); // wraps at 1000, never more than 3 digits
  });

  test("without BUILD_NUMBER the number is derived from the commit sha, deterministically", () => {
    const sha = "00ff12abcdef";
    const expected = String(parseInt("00ff12", 16) % 1000).padStart(3, "0");
    expect(releaseVersion({ date: NOW, buildNumber: undefined, sha })).toBe(`2026.10.02-${expected}`);
    expect(releaseVersion({ date: NOW, buildNumber: undefined, sha })).toBe(releaseVersion({ date: NOW, buildNumber: undefined, sha }));
    expect(releaseVersion({ date: NOW, buildNumber: undefined, sha: "" })).toBe("2026.10.02-000");
  });

  test("git sha, built_at, protocol 2 and the schema read from LOCAL_DB_VERSION", () => {
    fixture({ schema: "export const LOCAL_DB_VERSION = 5;\n" });
    const { manifest } = buildRelease({ root, env: { VERCEL_GIT_COMMIT_SHA: "abc123def456", BUILD_NUMBER: "1" }, now: NOW });
    expect(manifest.git_sha).toBe("abc123def456");
    expect(manifest.built_at).toBe("2026-10-02T09:30:00.000Z");
    expect(manifest.protocol).toBe(2);
    expect(manifest.schema).toBe(5);
  });

  test("files are sorted by path, carry the real size and sha256, and never include the release's own output", () => {
    fixture();
    const { manifest } = buildRelease({ root, env: { BUILD_NUMBER: "1" }, now: NOW });
    const paths = manifest.files.map((f: { path: string }) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual([
      "_next/static/chunks/app.js",
      "_next/static/chunks/zeta.css",
      "_next/static/media/font.woff2",
      "icons/icon-192.png",
      "logo-mark.svg",
    ]);
    const app = manifest.files.find((f: { path: string }) => f.path === "_next/static/chunks/app.js");
    expect(app).toEqual({ path: "_next/static/chunks/app.js", size: "console.log('app');".length, sha256: sha256("console.log('app');") });
    expect(paths.some((p: string) => p.startsWith("_release/"))).toBe(false);
  });

  test("manifest_sha256 is the sha256 of the canonical JSON of the manifest WITHOUT manifest_sha256 (the app's own canonicalisation agrees)", () => {
    fixture();
    const { manifest } = buildRelease({ root, env: { BUILD_NUMBER: "3" }, now: NOW });
    const { manifest_sha256, ...body } = manifest;
    expect(manifest_sha256).toBe(sha256(canonicalJson(body)));
    expect(manifest_sha256).toBe(sha256(appCanonicalJson(body)));
    // and the file on disk is the same manifest
    const onDisk = JSON.parse(readFileSync(join(root, "public", "_release", "release.json"), "utf8"));
    expect(onDisk).toEqual(manifest);
  });

  test("the prerendered /local shell is bundled as a virtual file when the build made it", () => {
    fixture({ shell: true });
    const { manifest } = buildRelease({ root, env: { BUILD_NUMBER: "1" }, now: NOW });
    const shell = manifest.files.find((f: { path: string }) => f.path === SHELL_FILE_PATH);
    expect(shell).toEqual({ path: "_shell/local.html", size: "<html>shell</html>".length, sha256: sha256("<html>shell</html>") });
  });
});

describe("release script: the bundle", () => {
  test("ONE bundle file px-<version>.tar.gz exists, and its recorded path, size and sha256 are the real file's", () => {
    fixture();
    const { manifest, dir } = buildRelease({ root, env: { BUILD_NUMBER: "9" }, now: NOW });
    expect(manifest.bundle.path).toBe("_release/px-2026.10.02-009.tar.gz");
    const bytes = readFileSync(join(dir, "px-2026.10.02-009.tar.gz"));
    expect(manifest.bundle.size).toBe(bytes.length);
    expect(manifest.bundle.sha256).toBe(sha256(bytes));
  });

  test("only the newest release is kept (older bundles and the old release.json are replaced)", () => {
    fixture();
    buildRelease({ root, env: { BUILD_NUMBER: "9" }, now: NOW });
    const names = readdirSync(join(root, "public", "_release")).sort();
    expect(names).toEqual(["px-2026.10.02-009.tar.gz", "release.json"]);
  });

  test("the app's own reader unpacks exactly the files the manifest lists (writer and reader agree)", async () => {
    fixture({ shell: true });
    const { manifest, dir } = buildRelease({ root, env: { BUILD_NUMBER: "2" }, now: NOW });
    const gz = new Uint8Array(readFileSync(join(dir, "px-2026.10.02-002.tar.gz")));
    const entries = readTar(await gunzip(gz));
    expect(entries.map((e) => e.path)).toEqual(manifest.files.map((f: { path: string }) => f.path));
    for (const entry of entries) {
      const listed = manifest.files.find((f: { path: string }) => f.path === entry.path);
      expect(entry.bytes.length).toBe(listed.size);
      expect(sha256(entry.bytes)).toBe(listed.sha256);
    }
  });

  test("a path longer than 100 bytes is stored with the ustar prefix and read back whole", async () => {
    fixture();
    const deep = `_next/static/${"very-long-directory-name/".repeat(5)}chunk-with-a-long-name-0123456789.js`;
    expect(deep.length).toBeGreaterThan(100);
    put(`.next/static/${deep.slice("_next/static/".length)}`, "deep file");
    const { manifest, dir } = buildRelease({ root, env: { BUILD_NUMBER: "2" }, now: NOW });
    const gz = new Uint8Array(readFileSync(join(dir, "px-2026.10.02-002.tar.gz")));
    const entries = readTar(await gunzip(gz));
    const found = entries.find((e) => e.path === deep);
    expect(found).toBeDefined();
    expect(new TextDecoder().decode(found!.bytes)).toBe("deep file");
    expect(manifest.files.some((f: { path: string }) => f.path === deep)).toBe(true);
  });

  test("the same inputs build the same bundle, byte for byte, and the same manifest", () => {
    fixture({ shell: true });
    const first = buildRelease({ root, env: { BUILD_NUMBER: "4" }, now: NOW });
    const bundle1 = readFileSync(join(first.dir, "px-2026.10.02-004.tar.gz"));
    const second = buildRelease({ root, env: { BUILD_NUMBER: "4" }, now: NOW });
    const bundle2 = readFileSync(join(second.dir, "px-2026.10.02-004.tar.gz"));
    expect(bundle2.equals(bundle1)).toBe(true);
    expect(second.manifest).toEqual(first.manifest);
  });

  test("changing one file changes that file's sha256, the bundle's and the manifest's", () => {
    fixture();
    const before = buildRelease({ root, env: { BUILD_NUMBER: "4" }, now: NOW }).manifest;
    put(".next/static/chunks/app.js", "console.log('app v2');");
    const after = buildRelease({ root, env: { BUILD_NUMBER: "4" }, now: NOW }).manifest;
    expect(after.bundle.sha256).not.toBe(before.bundle.sha256);
    expect(after.manifest_sha256).not.toBe(before.manifest_sha256);
    const pick = (m: typeof before, path: string) => m.files.find((f: { path: string }) => f.path === path).sha256;
    expect(pick(after, "_next/static/chunks/app.js")).not.toBe(pick(before, "_next/static/chunks/app.js"));
    expect(pick(after, "logo-mark.svg")).toBe(pick(before, "logo-mark.svg"));
  });
});

describe("release script: harmless and strict", () => {
  test("with no .next/static and no public/ it does nothing and writes nothing (exit code 0)", () => {
    const result = buildRelease({ root, env: {}, now: NOW });
    expect(result.skipped).toBe(true);
    expect(existsSync(join(root, "public"))).toBe(false);
    expect(main(["--root", root], {})).toBe(0);
  });

  test("a missing local database module is a real error: strict mode fails, --postbuild only warns", () => {
    put(".next/static/a.js", "x");
    const quiet = console.error;
    const warn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
      expect(main(["--root", root], {})).toBe(1);
      expect(main(["--root", root, "--postbuild"], {})).toBe(0);
    } finally {
      console.error = quiet;
      console.warn = warn;
    }
    expect(existsSync(join(root, "public", "_release"))).toBe(false);
  });
});
