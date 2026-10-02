// R5 guard: "no endpoint, tool or manual lets any AI change the software". Enumerates EVERY name the AI surface
// exposes -- the methods (and nested members) of window.projexa.ai, the WebMCP tools, the tool list the manual prints,
// and the registry functions the manual offers -- and fails if any matches the deny-list (code, script, eval, file,
// cache, serviceworker, bundle, release, config, ...). Also fails if the AI surface's own source offers an eval-like
// entry point.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManual } from "./manual";
import { DENY_WORDS, deniedNames, exposedNames, isDeniedName } from "./immutability";
import { publishAiSurface } from "./publish";
import { WRITE_FUNCTIONS } from "./registry";
import { TOOLS } from "./tools";
import { webMcpTools } from "./webmcp";
import { makeRig } from "./__fixtures__/ai-rig";

/** Every name an AI can reach, as one list. */
async function everyExposedName(): Promise<string[]> {
  const { surface } = await makeRig({ role: "admin" });
  const win: Record<string, unknown> = {};
  publishAiSurface(win, surface.api);
  const manual = buildManual();
  return [
    ...exposedNames((win as { projexa: unknown }).projexa, "projexa"),
    ...TOOLS.map((t) => t.name),
    ...TOOLS.map((t) => t.method),
    ...webMcpTools(surface.api).map((t) => t.name),
    ...manual.tools.map((t) => t.name),
    ...(["create", "update", "delete"] as const).flatMap((a) => manual.writes.functions[a].map((f) => f.id)),
    ...WRITE_FUNCTIONS.map((f) => f.function_id),
  ];
}

describe("the AI surface exposes nothing that can change the software", () => {
  test("the deny-list itself catches the names it is meant to catch", () => {
    for (const bad of ["writeCode", "runScript", "eval", "replaceFile", "clearCache", "updateServiceWorker", "service-worker", "installBundle", "setRelease", "editConfig", "appConfig"]) {
      expect(isDeniedName(bad)).toBe(true);
    }
    for (const good of ["manifest", "list", "get", "search", "create", "update", "delete", "manual", "drafts", "create_rfi", "update_task"]) {
      expect(isDeniedName(good)).toBe(false);
    }
    expect(DENY_WORDS).toEqual(expect.arrayContaining(["code", "script", "eval", "file", "cache", "serviceworker", "bundle", "release", "config"]));
  });

  test("no exposed tool, method or function name matches the deny-list", async () => {
    const names = await everyExposedName();
    expect(names).toContain("projexa.ai.create");
    expect(names).toContain("projexa_delete");
    expect(names.length).toBeGreaterThan(80);
    expect(deniedNames(names)).toEqual([]);
  });

  test("the surface is exactly the documented methods (a new one must be added here on purpose)", async () => {
    const { surface } = await makeRig();
    expect(Object.keys(surface.api).sort()).toEqual(["create", "delete", "drafts", "get", "list", "manifest", "manual", "search", "update", "version"]);
    expect(Object.isFrozen(surface.api)).toBe(true);
  });

  test("window.projexa.ai cannot be replaced by another script", async () => {
    const { surface } = await makeRig();
    const win: Record<string, unknown> = {};
    publishAiSurface(win, surface.api);
    const holder = win.projexa as { ai: unknown };
    expect(() => { "use strict"; (holder as { ai: unknown }).ai = { evil: true }; }).toThrow();
    expect(() => { "use strict"; win.projexa = {}; }).toThrow();
    expect(holder.ai).toBe(surface.api);
  });

  test("the AI surface's source has no eval-like entry point", () => {
    const dir = import.meta.dir;
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect({ f, hit: /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*["'`]|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]|import\s*\(\s*[^"'`\s]/.exec(src)?.[0] ?? null }).toEqual({ f, hit: null });
    }
  });
});
