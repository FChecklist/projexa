/// <reference types="bun-types" />
// R67 J-03 (audit R-280). Covers the parsing in
// ai-os/scripts/measure-public-page-transfer.mjs -- the two regexes that
// decide what a measurement counts, which is the only part of that script
// that can be quietly wrong (a missed <script> tag would understate the
// transfer figure the audit record reports, and a missed module would let
// the "no chart or animation library" claim pass over a chunk that has one).
//
// WHY IT LIVES IN src/: bunfig.toml scopes `[test] root = "src"`, so a
// sibling test next to the script itself would never be run by `bun test`
// or by CI. The script is imported by relative path instead.
import { describe, expect, test } from "bun:test";
import {
  FORBIDDEN_CLIENT_PACKAGES,
  PRERENDERED_ROUTES,
  TRANSFER_BUDGET_BYTES,
  classifyAsset,
  extractClientModules,
  extractNextAssets,
} from "../../ai-os/scripts/measure-public-page-transfer.mjs";

describe("extractNextAssets", () => {
  test("picks up scripts, stylesheets and font preloads, and de-duplicates", () => {
    const html = `<!DOCTYPE html><html><head>
      <link rel="preload" href="/_next/static/media/abc-s.p.woff2" as="font"/>
      <link rel="stylesheet" href="/_next/static/chunks/main.css"/>
      <script src="/_next/static/chunks/a.js"></script>
      <script src="/_next/static/chunks/a.js"></script>
      </head><body><a href="/how-it-works">nav</a><img src="https://cdn.example/x.png"/></body></html>`;
    expect(extractNextAssets(html)).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/main.css",
      "/_next/static/media/abc-s.p.woff2",
    ]);
  });

  test("ignores everything that is not served from /_next", () => {
    expect(extractNextAssets('<img src="/logo-mark.svg"><a href="/login">in</a>')).toEqual([]);
  });
});

describe("classifyAsset", () => {
  test("splits the kinds the report totals separately", () => {
    expect(classifyAsset("/_next/static/chunks/a.js")).toBe("js");
    expect(classifyAsset("/_next/static/chunks/a.css")).toBe("css");
    expect(classifyAsset("/_next/static/media/a-s.p.woff2")).toBe("font");
    expect(classifyAsset("/_next/static/media/hero.avif")).toBe("image");
    expect(classifyAsset("/_next/static/media/data.bin")).toBe("other");
  });
});

describe("extractClientModules", () => {
  test("reads module paths out of a client-reference manifest and normalises them", () => {
    const manifest =
      '{"[project]/projexa-worktrees/r67-J/src/components/marketing/Reveal.tsx [app-client]":{},' +
      '"[project]/projexa/node_modules/recharts/es6/index.js [app-client]":{}}';
    expect(extractClientModules(manifest)).toEqual([
      "node_modules/recharts/es6/index.js",
      "src/components/marketing/Reveal.tsx",
    ]);
  });

  test("the forbidden-package check would actually catch one", () => {
    const modules = extractClientModules('"[project]/x/node_modules/recharts/es6/index.js [app-client]"');
    const hits = FORBIDDEN_CLIENT_PACKAGES.filter((pkg) =>
      modules.some((mod) => mod.includes(`node_modules/${pkg}/`))
    );
    expect(hits).toEqual(["recharts"]);
  });

  test("and does not fire on an innocent bundle", () => {
    const modules = extractClientModules('"[project]/x/node_modules/next-themes/dist/index.mjs [app-client]"');
    const hits = FORBIDDEN_CLIENT_PACKAGES.filter((pkg) =>
      modules.some((mod) => mod.includes(`node_modules/${pkg}/`))
    );
    expect(hits).toEqual([]);
  });
});

describe("the script's constants", () => {
  test("measures exactly the two routes J-01 made prerenderable, at the audit's budget", () => {
    expect(Object.keys(PRERENDERED_ROUTES)).toEqual(["/", "/how-it-works"]);
    expect(TRANSFER_BUDGET_BYTES).toBe(500 * 1024);
  });
});
