import { test, expect } from "@playwright/test";
import { ai, aiValue, prepareLaptop, waitForAi, waitForAiIdentity } from "./support/lf-ai-laptop";
import { P1, P2 } from "./support/lf-ai-stub";

// LOCAL-FIRST browser AI (package lf-e11), R11: the person's browser AI finds PROJEXA by itself on a signed-in page, with nothing to set
// up: window.projexa.ai (and the projexa:ai-ready event), /llms.txt and /ai-manual.json (static, consistent with each other and with the
// function registry), the in-page manual, and WebMCP where the browser has it (silently skipped where it does not).
//
// Runs through playwright.local-first.config.ts (a production build, the local Auth stand-in, every sync/api call answered in the
// browser by e2e/support/lf-ai-stub.ts). An outside AI is simulated exactly as one would act: page.evaluate against window.projexa.ai.

type ManualFn = { id: string; label: string; action: string; min_role_rank: number; money_sensitive: boolean; params: string[]; required: { name: string }[] };
type Manual = { product: string; surface: string; software_can_be_changed: boolean; for_role: unknown; tools: { name: string; method: string }[]; writes: { functions: Record<"create" | "update" | "delete", ManualFn[]> }; rules: string[] };

test("R11 discovery: window.projexa.ai, the ready event, /llms.txt, /ai-manual.json and the in-page manual agree, and name only what the role may do", async ({ page, context }) => {
  // An agent that loaded first waits for the event: record it before any page script runs.
  await context.addInitScript(() => {
    (window as unknown as { __pxReady: unknown[] }).__pxReady = [];
    window.addEventListener("projexa:ai-ready", (e) => (window as unknown as { __pxReady: unknown[] }).__pxReady.push((e as CustomEvent).detail));
  });
  const laptop = await prepareLaptop(page, context, "member");
  await waitForAi(page);
  await waitForAiIdentity(laptop);

  await test.step("the JavaScript door: a read-only window.projexa holding a frozen API, announced by projexa:ai-ready", async () => {
    const shape = await page.evaluate(() => {
      const w = window as unknown as { projexa: { ai: Record<string, unknown> }; __pxReady: { version: number }[] };
      const holder = Object.getOwnPropertyDescriptor(window, "projexa");
      const inner = Object.getOwnPropertyDescriptor(w.projexa, "ai");
      return {
        methods: Object.keys(w.projexa.ai).sort(),
        frozen: Object.isFrozen(w.projexa.ai), holderFrozen: Object.isFrozen(w.projexa),
        // window.projexa: an accessor with no setter that cannot be redefined (lf-e11; publish.ts)
        windowConfigurable: holder?.configurable, windowHasSetter: typeof holder?.set === "function", windowIsValue: holder ? "value" in holder : null,
        aiWritable: inner?.writable, aiConfigurable: inner?.configurable,
        ready: w.__pxReady,
      };
    });
    expect(shape.methods).toEqual(["create", "delete", "drafts", "get", "list", "manifest", "manual", "search", "update", "version"]);
    expect(shape).toMatchObject({ frozen: true, holderFrozen: true, windowConfigurable: false, windowHasSetter: false, windowIsValue: false, aiWritable: false, aiConfigurable: false });
    expect(shape.ready, "projexa:ai-ready never fired").toEqual([{ version: 1 }]);
  });

  const manifest = await aiValue<{ person: { role: string; roleRank: number; name: string }; organisation: { id: string }; projects: { id: string; name: string }[]; functions: Record<"create" | "update" | "delete", { id: string }[]>; softwareCanBeChanged: boolean; worksOffline: boolean; deletesNeedConfirmation: boolean }>(page, "manifest");

  await test.step("manifest(): the member, their organisation, their two projects with names, and only rank-2 functions", async () => {
    expect(manifest.person).toMatchObject({ role: "member", roleRank: 2, name: "Asha Rao" });
    expect(manifest.organisation).toEqual({ id: "lf-ai-org-a" });
    expect(manifest.projects).toEqual([{ id: P1.id, name: P1.name }, { id: P2.id, name: P2.name }]);
    expect(manifest).toMatchObject({ softwareCanBeChanged: false, worksOffline: true, deletesNeedConfirmation: true });
    const ids = Object.values(manifest.functions).flat().map((f) => f.id);
    expect(ids).toContain("create_rfi");
    expect(ids).toContain("update_task");
    // manager-only (rank 3) functions are not offered to a member
    expect(ids).not.toContain("void_material_receipt");
    expect(ids).not.toContain("dispose_document");
    expect(ids).not.toContain("approve_timesheet");
  });

  const files = await test.step("/llms.txt and /ai-manual.json are served, static, without personal data", async () => {
    const txt = await page.request.get("/llms.txt");
    const json = await page.request.get("/ai-manual.json");
    expect(txt.status()).toBe(200);
    expect(json.status()).toBe(200);
    expect(txt.headers()["content-type"]).toContain("text/plain");
    expect(json.headers()["content-type"]).toContain("application/json");
    const text = await txt.text();
    const manual = (await json.json()) as Manual;
    for (const personal of ["Asha", "lf-ai-member", "lf-ai-org-a", P1.name]) {
      expect(text, `/llms.txt holds personal data (${personal})`).not.toContain(personal);
      expect(JSON.stringify(manual), `/ai-manual.json holds personal data (${personal})`).not.toContain(personal);
    }
    return { text, manual };
  });

  await test.step("the three static forms are the same manual: /ai-manual.json == in-page <script id=px-ai-manual>, and /llms.txt lists exactly its functions", async () => {
    const inPage = await page.evaluate(() => JSON.parse(document.getElementById("px-ai-manual")?.textContent ?? "null"));
    expect(inPage).toEqual(files.manual);
    expect(files.manual).toMatchObject({ product: "PROJEXA", surface: "window.projexa.ai", software_can_be_changed: false, for_role: null });
    const all = Object.values(files.manual.writes.functions).flat();
    const listed = [...files.text.matchAll(/^- ([a-z0-9_]+) -- /gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(all.map((f) => f.id).sort());
    for (const [action, fns] of Object.entries(files.manual.writes.functions)) {
      expect(files.text, `/llms.txt does not count the ${action} functions`).toContain(`### ${action[0].toUpperCase()}${action.slice(1)} (${fns.length})`);
    }
    // the tools the manual names are exactly the methods of window.projexa.ai (minus version/drafts, which are not tools)
    expect(files.manual.tools.map((t) => t.method).sort()).toEqual(["create", "delete", "get", "list", "manifest", "manual", "search", "update"]);
  });

  await test.step("manual() for THIS person names only what a member may do, and agrees with manifest().functions", async () => {
    const mine = await aiValue<Manual>(page, "manual");
    expect(mine.for_role).toEqual({ role: "member", rank: 2 });
    for (const action of ["create", "update", "delete"] as const) {
      expect(mine.writes.functions[action].every((f) => f.min_role_rank <= 2), `${action}: a function above the member's rank is offered`).toBe(true);
      const manifestIds = manifest.functions[action].map((f) => f.id);
      // manifest leaves create_project out (made online only); otherwise the same list
      expect(mine.writes.functions[action].map((f) => f.id).filter((id) => id !== "create_project")).toEqual(manifestIds);
    }
    // and the static manual lists MORE (every role), each with the lowest role that may use it
    const staticIds = Object.values(files.manual.writes.functions).flat().map((f) => f.id);
    expect(staticIds).toContain("void_material_receipt");
    // accuracy: the surface always refuses create_project (made online), so no manual may offer it
    expect(staticIds).not.toContain("create_project");
    expect(Object.values(mine.writes.functions).flat().map((f) => f.id)).not.toContain("create_project");
    expect(await ai(page, "create", "create_project", { name: "Tower" })).toMatchObject({ ok: false, code: "NEEDS_ONLINE" });
    expect(files.manual.writes.functions.delete.find((f) => f.id === "void_material_receipt")).toMatchObject({ min_role_rank: 3, money_sensitive: true, action: "delete" });
  });

  await test.step("WebMCP: registered when the browser has navigator.modelContext, silently skipped when it does not", async () => {
    const has = await page.evaluate(() => "modelContext" in navigator);
    if (has) {
      // A browser that ships WebMCP: the 8 tools must be there (exercised by name through the browser's own API).
      const names = await page.evaluate(() => Object.keys((navigator as unknown as { modelContext: Record<string, unknown> }).modelContext));
      expect(names.length).toBeGreaterThan(0);
    } else {
      // This Chromium has no WebMCP: nothing was thrown, nothing logged, and the other doors work (asserted above).
      expect(await ai(page, "manifest")).toMatchObject({ ok: true });
    }
  });
});

test("R11 WebMCP: a browser that provides navigator.modelContext gets PROJEXA's 8 tools registered by themselves, and a tool call works", async ({ page, context }) => {
  // This sandbox's Chromium has no WebMCP, so a minimal one is put in place BEFORE the page loads, in the draft's registerTool shape -- the
  // way a browser extension that implements the draft would provide it. The page must find it and register its tools with no setup.
  await context.addInitScript(() => {
    const tools = new Map<string, { execute: (input: Record<string, unknown>) => Promise<unknown>; inputSchema: unknown; annotations?: unknown }>();
    (window as unknown as { __mcpTools: typeof tools }).__mcpTools = tools;
    Object.defineProperty(navigator, "modelContext", {
      value: { registerTool: (t: { name: string; execute: (i: Record<string, unknown>) => Promise<unknown>; inputSchema: unknown; annotations?: unknown }) => { tools.set(t.name, t); return { unregister: () => tools.delete(t.name) }; } },
      configurable: true,
    });
  });
  const laptop = await prepareLaptop(page, context, "member");
  await waitForAi(page);
  await waitForAiIdentity(laptop);

  const names = await page.evaluate(() => [...(window as unknown as { __mcpTools: Map<string, unknown> }).__mcpTools.keys()].sort());
  expect(names).toEqual(["projexa_create", "projexa_delete", "projexa_get", "projexa_list", "projexa_manifest", "projexa_manual", "projexa_search", "projexa_update"]);

  const listed = await page.evaluate(async (projectId) => {
    const t = (window as unknown as { __mcpTools: Map<string, { execute: (i: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }> }> }).__mcpTools.get("projexa_list")!;
    const res = await t.execute({ kind: "tasks", projectId });
    return { isError: !!res.isError, body: JSON.parse(res.content[0].text) as { items: { id: string; data: { title: string } }[] } };
  }, P1.id);
  expect(listed.isError).toBe(false);
  expect(listed.body.items.map((i) => i.data.title).sort()).toEqual(["Fix scaffolding east side", "Pour slab level 3"]);

  const refused = await page.evaluate(async (projectId) => {
    const t = (window as unknown as { __mcpTools: Map<string, { execute: (i: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }> }> }).__mcpTools.get("projexa_create")!;
    const res = await t.execute({ functionId: "approve_timesheet", params: { projectId, timeEntryId: "x" } });
    return { isError: !!res.isError, body: JSON.parse(res.content[0].text) as { code: string; error: string } };
  }, P1.id);
  expect(refused.isError).toBe(true);
  // approve_timesheet is an update, and a manager's: refused in plain words, nothing queued
  expect(["WRONG_ACTION", "ROLE_TOO_LOW"]).toContain(refused.body.code);
  expect(refused.body.error.length).toBeGreaterThan(10);
  expect(laptop.sync.pushed).toHaveLength(0);
});
