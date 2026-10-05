// AUDIT-100 B60: after a build, uploads this build's static files to the free Cloudflare Pages project -- ONLY when the switch
// NEXT_PUBLIC_PX_STATIC_BASE is on. Run by `postbuild` (package.json) right after scripts/make-release.mjs.
//
//   switch OFF (the default, today's production): prints "skipped" and exits 0. Nothing else happens.
//   switch ON:  1. stages the release this build just made (scripts/stage-static-pages.mjs: every byte verified against the manifest);
//               2. KEEPS the previous release's code: the release the static host serves now is downloaded and verified, and every one
//                  of its /_next/static files the new build does not have is added (a person with a page of the previous build open
//                  still loads that build's lazy chunks; the names are content-hashed, so nothing is overwritten);
//               3. `wrangler pages deploy` to the project (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID from the environment, never printed).
//               ANY failure exits 1, which FAILS THE BUILD: a deployment whose pages point at code the static host does not have must
//               never go live. ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md has the owner's switch.
//
// Env: NEXT_PUBLIC_PX_STATIC_BASE, PX_STATIC_PAGES_PROJECT (default projexa-static), PX_STATIC_PAGES_BRANCH (default main),
//      CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.  Flags: --dry-run (stage and merge, do not upload), --out <dir> (default .static-pages).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export function staticBaseFromEnv(env = process.env) {
  const raw = String(env.NEXT_PUBLIC_PX_STATIC_BASE ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/** Adds the previous release's /_next/static files the new folder lacks. Returns how many were kept. Throws when the previous release does not verify. */
export function keepPrevious({ outDir, manifestBytes, bundleBytes, verifyManifest, readTar, sha256Hex }) {
  const manifest = verifyManifest(manifestBytes);
  if (bundleBytes.length !== manifest.bundle.size || sha256Hex(bundleBytes) !== manifest.bundle.sha256) throw new Error("the previous release's bundle does not match its manifest");
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  let kept = 0;
  for (const e of readTar(gunzipSync(bundleBytes))) {
    const f = listed.get(e.path);
    if (!f || !e.path.startsWith("_next/static/") || e.bytes.length !== f.size || sha256Hex(e.bytes) !== f.sha256) continue;
    const full = join(outDir, ...e.path.split("/"));
    if (existsSync(full)) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, e.bytes);
    kept += 1;
  }
  return { previous_release: manifest.release_version, kept };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const base = staticBaseFromEnv(env);
  if (!base) {
    console.log("[static-pages] skipped: NEXT_PUBLIC_PX_STATIC_BASE is not set (static files stay on the app origin)");
    return 0;
  }
  const i = argv.indexOf("--out");
  const outDir = i >= 0 && argv[i + 1] ? argv[i + 1] : ".static-pages";
  const dryRun = argv.includes("--dry-run");
  try {
    const { stageRelease, verifyManifest, readTar } = await import("./stage-static-pages.mjs");
    const { sha256Hex } = await import("./make-release.mjs");
    const { readFileSync } = await import("node:fs");
    const releaseDir = join(process.cwd(), "public", "_release");
    const manifestBytes = readFileSync(join(releaseDir, "release.json"));
    const manifest = verifyManifest(manifestBytes);
    const summary = stageRelease({ manifestBytes, bundleBytes: readFileSync(join(releaseDir, manifest.bundle.path.slice("_release/".length))), outDir });
    console.log(`[static-pages] staged ${summary.release_version}: ${summary.files} files`);

    // the previous release, from the static host itself (best effort when the host has none yet; a release that does not VERIFY stops)
    let previous = null;
    try {
      const res = await fetch(`${base}/_release/release.json`, { cache: "no-store" });
      if (res.ok) previous = Buffer.from(await res.arrayBuffer());
    } catch {
      previous = null;
    }
    if (previous) {
      const prev = verifyManifest(previous);
      if (prev.manifest_sha256 !== manifest.manifest_sha256) {
        const b = await fetch(`${base}/${prev.bundle.path}`, { cache: "no-store" });
        if (!b.ok) throw new Error(`the previous release's bundle answered ${b.status}`);
        const kept = keepPrevious({ outDir, manifestBytes: previous, bundleBytes: Buffer.from(await b.arrayBuffer()), verifyManifest, readTar, sha256Hex });
        console.log(`[static-pages] kept ${kept.kept} code files of the previous release ${kept.previous_release}`);
      }
    } else {
      console.log("[static-pages] the static host serves no release yet: nothing to keep");
    }

    if (dryRun) {
      console.log(`[static-pages] dry run: not uploaded (${outDir})`);
      return 0;
    }
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not set: cannot upload, and a build whose pages point at a static host without its code must not go live");
    const project = env.PX_STATIC_PAGES_PROJECT || "projexa-static";
    const branch = env.PX_STATIC_PAGES_BRANCH || "main";
    execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "wrangler@3", "pages", "deploy", outDir, "--project-name", project, "--branch", branch, "--commit-dirty=true"], { stdio: "inherit", env });
    console.log(`[static-pages] uploaded ${summary.release_version} to ${project} (${base})`);
    return 0;
  } catch (err) {
    console.error(`[static-pages] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
