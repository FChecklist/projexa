/// <reference types="bun-types" />
// LOCAL-FIRST: the /local shell must be a STATIC document that can run with no server. This pins that from the source, in the same
// spirit as src/app/public-routes-static.test.ts:
//
//   1. both pages declare `dynamic = "force-static"` and read nothing from the request;
//   2. NOTHING reachable from either page -- followed through every static import and dynamic import(), through the whole src tree --
//      is a server-only module: no next/headers, no server Supabase client, no auth-guard, no database, no VERIDIAN client, no node: builtin;
//   3. no file in that graph calls cookies() or headers().
//
// The graph walk is the "verify by reading the code" step made repeatable: add an import that drags a server module into the shell and
// this fails, naming the file and the import that did it.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isPublicPagePath, requiresAuthenticatedPage } from "@/lib/authz/page-access";

const SRC = resolve(import.meta.dir, "..", "..");
const PAGES = [join(import.meta.dir, "page.tsx"), join(import.meta.dir, "[...path]", "page.tsx")];

/** Specifiers (exact or prefix) a static, server-less document must never reach. */
const FORBIDDEN: { test: (spec: string) => boolean; why: string }[] = [
  { test: (s) => s === "next/headers", why: "next/headers reads the request" },
  { test: (s) => s === "server-only" || s.startsWith("server-only/"), why: "server-only" },
  { test: (s) => s === "@/lib/supabase/server" || s.endsWith("/supabase/server"), why: "the server Supabase client reads cookies" },
  { test: (s) => s === "@/lib/supabase/auth-guard" || s.endsWith("/supabase/auth-guard"), why: "auth-guard is server-side authorisation" },
  { test: (s) => s === "@/lib/veridian-client" || s.endsWith("/veridian-client"), why: "the VERIDIAN proxy client is server-side" },
  { test: (s) => s === "@/lib/db" || s.startsWith("@/lib/db/"), why: "the database" },
  { test: (s) => s === "postgres" || s === "drizzle-orm" || s.startsWith("drizzle-orm/"), why: "a database driver" },
  { test: (s) => s === "googleapis" || s === "resend", why: "a server-side API client" },
  { test: (s) => s.startsWith("node:") || ["fs", "path", "os", "crypto", "child_process", "http", "https", "net", "tls", "zlib", "stream"].includes(s), why: "a Node built-in" },
  { test: (s) => s === "next/server", why: "next/server is server-side" },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w])\/\/[^\n]*/g, "$1");
}

/** Every module specifier a file imports: `import ... from "x"`, `export ... from "x"`, `import("x")`, `import "x"`. */
function specifiersOf(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^"'`;]*?\sfrom\s*["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^"'`;]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1]!);
  return out;
}

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

type Walk = { files: Set<string>; violations: string[]; unresolved: string[] };

function walk(entries: string[]): Walk {
  const files = new Set<string>();
  const violations: string[] = [];
  const unresolved: string[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    if (/\bcookies\s*\(/.test(stripComments(source)) || /\bheaders\s*\(\s*\)/.test(stripComments(source))) violations.push(`${rel}: calls cookies()/headers()`);
    for (const spec of specifiersOf(source)) {
      const bad = FORBIDDEN.find((f) => f.test(spec));
      if (bad) violations.push(`${rel} imports "${spec}" (${bad.why})`);
      const local = resolveLocal(spec, file);
      if (local) {
        if (/\.(css|svg|png|json)$/.test(local)) continue;
        queue.push(local);
      } else if (spec.startsWith("@/") || spec.startsWith(".")) {
        unresolved.push(`${rel} imports "${spec}" which does not resolve`);
      }
    }
  }
  return { files, violations, unresolved };
}

describe("/local is a static document", () => {
  test("both pages declare force-static", async () => {
    for (const page of PAGES) {
      const mod = (await import(page)) as { dynamic?: unknown };
      expect(`${page}: ${mod.dynamic}`).toBe(`${page}: force-static`);
    }
  });

  test("neither page reads anything from the request", () => {
    for (const page of PAGES) {
      const source = stripComments(readFileSync(page, "utf8"));
      for (const banned of ["cookies(", "headers(", "searchParams", "createClient", "getClaims", "next/headers", "params"]) {
        expect(`${page}: ${banned}: ${source.includes(banned)}`).toBe(`${page}: ${banned}: false`);
      }
    }
  });

  test("the import graph from both pages reaches no server module, and every import resolves", () => {
    const result = walk(PAGES);
    expect(result.violations).toEqual([]);
    expect(result.unresolved).toEqual([]);
    // the walk really went through the shell, not just two files
    const rels = [...result.files].map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));
    for (const expected of [
      "components/local-first/LocalShellEntry.tsx",
      "lib/local-first/shell/LocalShell.tsx",
      "lib/local-first/shell/route-table.ts",
      "lib/local-first/shell/modules/ScopeObjectScreen.tsx",
      "lib/local-first/identity.ts",
      "lib/local-first/connectivity.ts",
    ]) {
      expect(rels).toContain(expected);
    }
    expect(result.files.size).toBeGreaterThan(30);
  });

  test("the walk can fail: a planted server import is caught", () => {
    const planted = join(SRC, "lib", "local-first", "shell", "__planted.ts");
    // Not written to disk: exercise the same detector on text.
    const text = `import { cookies } from "next/headers";\nexport const x = cookies();`;
    const hit = specifiersOf(text).filter((s) => FORBIDDEN.some((f) => f.test(s)));
    expect(hit).toEqual(["next/headers"]);
    expect(/\bcookies\s*\(/.test(stripComments(text))).toBe(true);
    expect(planted.endsWith("__planted.ts")).toBe(true);
    expect(specifiersOf(`const m = await import("@/lib/db");`).filter((s) => FORBIDDEN.some((f) => f.test(s)))).toEqual(["@/lib/db"]);
    expect(specifiersOf(`export { a } from "node:fs";`).filter((s) => FORBIDDEN.some((f) => f.test(s)))).toEqual(["node:fs"]);
  });

  test("the shell is reachable without a session: the page gate lets /local and /local/** through", () => {
    for (const path of ["/local", "/local/scope", "/local/scope/abc-123"]) {
      expect(isPublicPagePath(path)).toBe(true);
      expect(requiresAuthenticatedPage(path)).toBe(false);
    }
    // ...and only that: the app's own pages are still gated
    expect(requiresAuthenticatedPage("/scope")).toBe(true);
    expect(requiresAuthenticatedPage("/locals")).toBe(true);
  });
});
