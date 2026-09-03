/// <reference types="bun-types" />
// R67 J-03 (audit R-280). The drift guard for the client message payload.
//
// The whole point of CLIENT_MESSAGE_NAMESPACES is that it is SMALLER than
// the catalogue, so it is only safe if it cannot silently drift from the
// components that actually read it. This regenerates it from the filesystem
// in both directions:
//   - a `useTranslations("X.y")` in a "use client" file that no entry covers
//     would resolve to nothing in the browser -> fail;
//   - an entry no client file asks for is dead payload on every route -> fail.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_MESSAGE_NAMESPACES, pickClientMessages, type MessageTree } from "./client-messages";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";

const SRC_DIR = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Comments are stripped before scanning, because this file's own siblings
 * document the pattern they are matched by -- a namespace named in prose
 * must not become a namespace shipped to the browser. The `[^:"'`\w]` guard
 * on the line-comment rule keeps `https://...` inside a string intact.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w])\/\/[^\n]*/g, "$1");
}

/**
 * Every namespace literal passed to useTranslations() anywhere in src/. The
 * `\(\s*"` shape deliberately does not match `ReturnType<typeof
 * useTranslations>` (AppSidebar.tsx:200) or a bare `useTranslations()`.
 */
function usedClientNamespaces(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/\buseTranslations\(\s*"([^"]+)"/g)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

// Scanned once at module scope. Walking every .ts/.tsx file under src/ takes
// well over bun's 5 s per-test timeout when the whole suite is running in
// parallel, and both tests below want the same answer.
const USED_NAMESPACES = usedClientNamespaces();

function resolvePath(tree: MessageTree, namespace: string): unknown {
  let node: unknown = tree;
  for (const segment of namespace.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as MessageTree)[segment];
  }
  return node;
}

describe("CLIENT_MESSAGE_NAMESPACES", () => {
  test("covers every namespace a client component actually asks for", () => {
    const uncovered = USED_NAMESPACES.filter(
      (used) =>
        !CLIENT_MESSAGE_NAMESPACES.some(
          (allowed) => used === allowed || used.startsWith(`${allowed}.`)
        )
    );
    expect(uncovered).toEqual([]);
  });

  test("carries nothing no client component asks for", () => {
    const used = USED_NAMESPACES;
    const unused = CLIENT_MESSAGE_NAMESPACES.filter(
      (allowed) =>
        !used.some((u) => u === allowed || u.startsWith(`${allowed}.`) || allowed.startsWith(`${u}.`))
    );
    expect(unused).toEqual([]);
  });

  test("every listed namespace resolves in every locale file", () => {
    for (const [locale, messages] of Object.entries({ en, hi })) {
      for (const namespace of CLIENT_MESSAGE_NAMESPACES) {
        expect(`${locale}:${namespace}:${resolvePath(messages as MessageTree, namespace) !== undefined}`)
          .toBe(`${locale}:${namespace}:true`);
      }
    }
  });
});

describe("pickClientMessages", () => {
  test("keeps the picked subtrees intact and identical to the source", () => {
    const picked = pickClientMessages(en as MessageTree);
    for (const namespace of CLIENT_MESSAGE_NAMESPACES) {
      expect(resolvePath(picked, namespace)).toEqual(resolvePath(en as MessageTree, namespace));
    }
  });

  test("drops the server-only namespaces -- this is the payload saving", () => {
    const picked = pickClientMessages(en as MessageTree) as MessageTree;
    const marketing = picked.Marketing as MessageTree;
    // Read by Server Components through getTranslations(), which never
    // touches the client provider.
    expect(marketing.hero).toBeUndefined();
    expect(marketing.moduleCatalog).toBeUndefined();
    expect(marketing.howItWorks).toBeUndefined();
    expect(marketing.footer).toBeUndefined();
    // ...and keeps the two the browser genuinely needs.
    expect(marketing.header).toBeDefined();
    expect(marketing.contactForm).toBeDefined();
  });

  test("is materially smaller than the full catalogue in both locales", () => {
    for (const messages of [en, hi]) {
      const full = JSON.stringify(messages).length;
      const picked = JSON.stringify(pickClientMessages(messages as MessageTree)).length;
      expect(picked).toBeLessThan(full / 2);
    }
  });

  test("a namespace missing from the catalogue is skipped, not thrown", () => {
    const picked = pickClientMessages({ Nav: { a: "b" } }, ["Nav", "Nope.Missing"]);
    expect(picked).toEqual({ Nav: { a: "b" } });
  });
});
