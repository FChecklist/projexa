#!/usr/bin/env node
// R67 J-03 (audit R-280): "Landing page first-load transfer budget of 500 KB".
//
// WHY THIS EXISTS RATHER THAN @next/bundle-analyzer: the analyzer is not a
// dependency of this repo and adding one was out of scope for the change
// that needed the number. This measures the same thing more directly and
// with no new dependency -- it reads the PRERENDERED HTML that `next build`
// writes for a statically generated route and adds up every asset that HTML
// tells a cold browser to fetch:
//
//   the gzipped HTML document itself
// + every /_next/static/*.js it <script>s
// + every /_next/static/*.css it <link>s
// + every /_next/static/media/*.woff2 it preloads
//
// which is exactly the "sum of response body sizes from page.on('response')"
// the audit's acceptance clause describes for a cold load, minus anything
// the page fetches at runtime after hydration (there is nothing on these two
// routes: they are static marketing pages with no data dependency).
//
// It only works on a route that `next build` actually prerendered -- which
// is the point, since J-01 is what made these two prerenderable. A dynamic
// route has no HTML on disk and is reported as such rather than guessed at.
//
// Usage, from the repo root, after `next build`:
//   node ai-os/scripts/measure-public-page-transfer.mjs
//   node ai-os/scripts/measure-public-page-transfer.mjs --label before --out ai-os/audit/public_pages_transfer.json
//
// NOTE on running a build in a git worktree whose node_modules is a
// junction to the main checkout: Turbopack refuses it ("Symlink
// [project]/node_modules is invalid, it points out of the filesystem root").
// Build from the main checkout, or widen next.config.ts's turbopack.root for
// the measurement run only.

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";

// Route -> the files `next build` writes for it under .next/server/app/.
// "/" is written as index.html, not page.html; its client-reference manifest
// is still page_client-reference-manifest.js.
export const PRERENDERED_ROUTES = {
  "/": { html: "index.html", clientManifest: "page_client-reference-manifest.js" },
  "/how-it-works": {
    html: "how-it-works.html",
    clientManifest: "how-it-works/page_client-reference-manifest.js",
  },
};

/** The audit's budget, in bytes of transferred body. */
export const TRANSFER_BUDGET_BYTES = 500 * 1024;

/** Every /_next/... URL the document tells a cold browser to fetch. */
export function extractNextAssets(html) {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) {
    urls.add(match[1]);
  }
  return [...urls].sort();
}

export function classifyAsset(url) {
  if (url.endsWith(".css")) return "css";
  if (url.endsWith(".js")) return "js";
  if (/\.(woff2?|ttf|otf)$/.test(url)) return "font";
  if (/\.(png|jpe?g|webp|avif|svg|gif)$/.test(url)) return "image";
  return "other";
}

async function gzippedSize(path) {
  let total = 0;
  await pipeline(
    createReadStream(path),
    createGzip({ level: 9 }),
    async function* (source) {
      for await (const chunk of source) total += chunk.length;
    }
  );
  return total;
}

async function gzippedSizeOfString(text) {
  const { gzipSync } = await import("node:zlib");
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 }).length;
}

/** Maps a /_next/... URL to the file on disk that serves it. */
function assetPath(root, url) {
  return join(root, ".next", url.replace(/^\/_next\//, "").split("?")[0]);
}

/**
 * Every module that crosses into the browser for a route, read from the
 * client-reference manifest `next build` writes beside the route. This is
 * what answers the audit's "no chart or animation library in the '/'
 * first-load chunks" clause -- by real module path, not by grepping minified
 * output for a package name that minification already removed.
 */
export function extractClientModules(manifestSource) {
  const modules = new Set();
  for (const match of manifestSource.matchAll(/\[project\]\/([^"\\ ]+)/g)) {
    // Normalised to repo-relative, so the record does not depend on which
    // checkout or worktree the build happened to run in.
    modules.add(
      match[1].includes("node_modules/")
        ? match[1].replace(/^.*?node_modules\//, "node_modules/")
        : match[1].replace(/^.*?\/(src\/)/, "$1")
    );
  }
  return [...modules].sort();
}

/** Package names that must never appear in a public marketing page's bundle. */
export const FORBIDDEN_CLIENT_PACKAGES = [
  "recharts",
  "three",
  "@react-three",
  "@svar-ui",
  "embla-carousel",
  "@tanstack/react-table",
];

export async function measureRoute(root, route, { html: htmlFile, clientManifest }) {
  const htmlPath = join(root, ".next", "server", "app", htmlFile);
  let html;
  try {
    html = await readFile(htmlPath, "utf8");
  } catch {
    return {
      route,
      prerendered: false,
      note: `${htmlFile} was not written by next build -- the route is server-rendered on demand, so there is no cold-load document to measure.`,
    };
  }

  const assets = [];
  let rawTotal = Buffer.byteLength(html, "utf8");
  let gzipTotal = await gzippedSizeOfString(html);

  for (const url of extractNextAssets(html)) {
    const path = assetPath(root, url);
    let raw;
    try {
      raw = (await stat(path)).size;
    } catch {
      assets.push({ url, kind: classifyAsset(url), missing: true });
      continue;
    }
    const kind = classifyAsset(url);
    // Fonts and images are already compressed; a shared cache serves them
    // as-is, so counting a gzip pass over them would understate the wire.
    const gzip = kind === "font" || kind === "image" ? raw : await gzippedSize(path);
    assets.push({ url, kind, rawBytes: raw, gzipBytes: gzip });
    rawTotal += raw;
    gzipTotal += gzip;
  }

  const byKind = {};
  for (const asset of assets) {
    if (asset.missing) continue;
    byKind[asset.kind] ??= { count: 0, rawBytes: 0, gzipBytes: 0 };
    byKind[asset.kind].count += 1;
    byKind[asset.kind].rawBytes += asset.rawBytes;
    byKind[asset.kind].gzipBytes += asset.gzipBytes;
  }

  let clientModules = null;
  let forbiddenPackages = null;
  try {
    const manifest = await readFile(join(root, ".next", "server", "app", clientManifest), "utf8");
    clientModules = extractClientModules(manifest);
    forbiddenPackages = FORBIDDEN_CLIENT_PACKAGES.filter((pkg) =>
      clientModules.some((mod) => mod.includes(`node_modules/${pkg}/`))
    );
  } catch {
    // Left null rather than reported as "clean": an absent manifest proves
    // nothing.
  }

  return {
    route,
    prerendered: true,
    htmlBytes: Buffer.byteLength(html, "utf8"),
    assetCount: assets.length,
    rawBytes: rawTotal,
    gzipBytes: gzipTotal,
    withinBudget: gzipTotal <= TRANSFER_BUDGET_BYTES,
    budgetBytes: TRANSFER_BUDGET_BYTES,
    byKind,
    forbiddenPackages,
    clientModules,
    assets,
  };
}

export async function measureAll(root = process.cwd()) {
  const routes = [];
  for (const [route, files] of Object.entries(PRERENDERED_ROUTES)) {
    routes.push(await measureRoute(root, route, files));
  }
  return routes;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const args = process.argv.slice(2);
  const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "measurement";
  const outIndex = args.indexOf("--out");
  const root = process.cwd();

  const routes = await measureAll(root);

  for (const result of routes) {
    if (!result.prerendered) {
      console.log(`${result.route}: NOT PRERENDERED -- ${result.note}`);
      continue;
    }
    console.log(
      `${result.route}: ${kb(result.gzipBytes)} gzipped / ${kb(result.rawBytes)} raw ` +
        `across ${result.assetCount} assets + the document ` +
        `(budget ${kb(result.budgetBytes)} -> ${result.withinBudget ? "PASS" : "FAIL"})`
    );
    for (const [kind, totals] of Object.entries(result.byKind)) {
      console.log(`    ${kind.padEnd(6)} ${String(totals.count).padStart(3)} files  ${kb(totals.gzipBytes)}`);
    }
    if (result.clientModules === null) {
      console.log("    client modules: manifest not found -- not asserting anything about them");
    } else {
      console.log(
        `    client modules: ${result.clientModules.length}, ` +
          (result.forbiddenPackages.length === 0
            ? "no chart/animation library"
            : `FORBIDDEN: ${result.forbiddenPackages.join(", ")}`)
      );
    }
  }

  if (outIndex !== -1) {
    const out = resolve(root, args[outIndex + 1]);
    let existing = { measurements: {} };
    try {
      existing = JSON.parse(await readFile(out, "utf8"));
    } catch {
      // first write
    }
    existing.what =
      "R67 J-03 (audit R-280). Cold first-load transfer for PROJEXA's two public " +
      "marketing routes, read out of `next build`'s own prerendered output by " +
      "ai-os/scripts/measure-public-page-transfer.mjs.";
    existing.howMeasured = [
      "gzipBytes = the gzipped HTML document + gzip of every /_next/static .js and .css it references + the raw size of every woff2 it preloads (fonts are already compressed, so gzipping them again would understate the wire).",
      "This is the cold-load sum a browser fetches before hydration. These routes fetch nothing at runtime -- they are static marketing pages with no data dependency -- so there is nothing after it.",
      "A CDN serving brotli will transfer LESS than the gzip figure; the number here is the conservative one.",
      "clientModules comes from the route's client-reference manifest, i.e. the real module paths that cross into the browser -- not a grep of minified chunks for a package name minification already removed.",
    ];
    existing.notMeasuredHere = [
      "TTFB and FCP. Both need a running server, and the R67 programme forbids starting one in these worktrees; the ISR half of the same change is evidenced instead by `next build` reporting both routes as `o (Static)` with a 1h revalidate, where they were `f (Dynamic)` before.",
    ];
    existing.measurements ??= {};
    existing.measurements[label] = { measuredAt: new Date().toISOString(), routes };
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    console.log(`\nwrote "${label}" to ${out}`);
  }
}

// Deliberately not an `import.meta.main` guard: that is false under some
// Windows path spellings, which is exactly the trap the compliance-tracker
// coverage script fell into. An explicit argv check is unambiguous.
if (process.argv[1] && process.argv[1].endsWith("measure-public-page-transfer.mjs")) {
  await main();
}
