// AUDIT-100 A3 (VERCEL_ROUTE_PLAN.md step 1): the rules of the hand-over from a server-rendered page to the on-laptop shell. The real-browser
// proof (the first session after the install leaves the laptop 0 times for app pages) is e2e/lf-lifecycle-vercel-budget.spec.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyingNow, editingNow, fullNavigationTarget, handOff, markCopying, mustStayOnServer, shellServes, type HandoffEnv } from "./shell-handoff";

const ACTIVE = { ok: true, version: "2026.10.05-001", personId: "u1", localFirst: true, signedOut: false };

function env(href: string, over: Partial<HandoffEnv> = {}) {
  const url = new URL(href);
  const store = new Map<string, string>();
  const replaced: string[] = [];
  const e: HandoffEnv = {
    location: { href: url.href, pathname: url.pathname, search: url.search, origin: url.origin, replace: (u) => { replaced.push(u); }, assign: () => {} },
    session: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } },
    isEditing: () => false,
    isBusy: () => false,
    now: () => 1_000_000,
    ...over,
  };
  return { e, replaced };
}

describe("shellServes: only when the worker would answer a navigation with the shell", () => {
  test("active pointer, local-first on, a controller, the same person", () => {
    expect(shellServes(ACTIVE, "u1", true)).toBe(true);
    expect(shellServes(ACTIVE, null, true)).toBe(true);
  });
  test("each missing piece says no", () => {
    expect(shellServes(ACTIVE, "u1", false)).toBe(false);
    expect(shellServes(null, "u1", true)).toBe(false);
    expect(shellServes({ ...ACTIVE, version: null }, "u1", true)).toBe(false);
    expect(shellServes({ ...ACTIVE, localFirst: false }, "u1", true)).toBe(false);
    expect(shellServes({ ...ACTIVE, signedOut: true }, "u1", true)).toBe(false);
    expect(shellServes({ ...ACTIVE, personId: "u2" }, "u1", true)).toBe(false);
  });
});

describe("handOff", () => {
  const sw = { status: async () => ACTIVE };
  test("replaces the current address once (the worker answers it with the shell)", async () => {
    const { e, replaced } = env("https://px.test/dashboard?projectId=p1");
    expect(await handOff({ sw, personId: null, hasController: () => true, env: e })).toBe("handed_off");
    expect(replaced).toEqual(["https://px.test/dashboard?projectId=p1"]);
    // the loop guard: the same address is not replaced again at once
    expect(await handOff({ sw, personId: null, hasController: () => true, env: e })).toBe("repeat");
    expect(replaced).toHaveLength(1);
  });
  test("never: a server page asked for on purpose, the shell itself, a public page, a field being edited, a copy running, the shell not ready", async () => {
    for (const [href, want] of [["https://px.test/rfis?px-server=1", "stay_on_server"], ["https://px.test/local/scope", "stay_on_server"], ["https://px.test/login", "stay_on_server"]] as const) {
      const { e, replaced } = env(href);
      expect(await handOff({ sw, personId: null, hasController: () => true, env: e })).toBe(want);
      expect(replaced).toEqual([]);
    }
    const editing = env("https://px.test/dashboard", { isEditing: () => true });
    expect(await handOff({ sw, personId: null, hasController: () => true, env: editing.e })).toBe("editing");
    const busy = env("https://px.test/dashboard", { isBusy: () => true });
    expect(await handOff({ sw, personId: null, hasController: () => true, env: busy.e })).toBe("busy");
    const notReady = env("https://px.test/dashboard");
    expect(await handOff({ sw: { status: async () => ({ ...ACTIVE, signedOut: true }) }, personId: null, hasController: () => true, env: notReady.e })).toBe("not_ready");
    expect(await handOff({ sw, personId: null, hasController: () => false, env: notReady.e })).toBe("not_ready");
    expect([...editing.replaced, ...busy.replaced, ...notReady.replaced]).toEqual([]);
  });
  test("a blocked sessionStorage means no replace (no loop can be ruled out)", async () => {
    const { e, replaced } = env("https://px.test/dashboard", { session: { getItem: () => { throw new Error("blocked"); }, setItem: () => {} } });
    expect(await handOff({ sw, personId: null, hasController: () => true, env: e })).toBe("repeat");
    expect(replaced).toEqual([]);
  });
});

describe("a projects copy in this page holds the hand-over", () => {
  test("markCopying / copyingNow", () => {
    expect(copyingNow()).toBe(false);
    const a = markCopying();
    const b = markCopying();
    expect(copyingNow()).toBe(true);
    a();
    a();
    expect(copyingNow()).toBe(true);
    b();
    expect(copyingNow()).toBe(false);
  });
});

describe("fullNavigationTarget: a plain in-app link click becomes a full navigation", () => {
  const anchor = (href: string, attrs: Record<string, string> = {}) => ({
    getAttribute: (n: string) => (n === "href" ? href : attrs[n] ?? null),
    hasAttribute: (n: string) => n in attrs,
    href: new URL(href, "https://px.test").href,
  });
  const click = (a: ReturnType<typeof anchor> | null, over: Record<string, unknown> = {}) => ({
    defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    target: { closest: () => a }, preventDefault() {}, stopImmediatePropagation() {}, ...over,
  });
  test("in-app pages are taken; everything else is left to the browser / Next", () => {
    expect(fullNavigationTarget(click(anchor("/schedule?projectId=p1")), "https://px.test")).toBe("/schedule?projectId=p1");
    expect(fullNavigationTarget(click(anchor("/api/x")), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("https://elsewhere.test/a")), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/files/a.pdf")), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("#top")), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/login")), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/schedule", { target: "_blank" })), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/schedule", { download: "" })), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/schedule"), { ctrlKey: true }), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/schedule"), { button: 1 }), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(anchor("/schedule"), { defaultPrevented: true }), "https://px.test")).toBeNull();
    expect(fullNavigationTarget(click(null), "https://px.test")).toBeNull();
  });
});

test("editingNow: inputs, text areas, selects and editable regions", () => {
  expect(editingNow({ activeElement: { tagName: "INPUT" } as Element })).toBe(true);
  expect(editingNow({ activeElement: { tagName: "TEXTAREA" } as Element })).toBe(true);
  expect(editingNow({ activeElement: { tagName: "DIV", isContentEditable: true } as unknown as Element })).toBe(true);
  expect(editingNow({ activeElement: { tagName: "BUTTON" } as Element })).toBe(false);
  expect(editingNow({ activeElement: null })).toBe(false);
});

test("wiring: the (app) layout mounts the hand-over once; the prepare screen and the boot announce the shell; the warm-up is flag-off only", () => {
  const ROOT = join(import.meta.dir, "..", "..", "..", "..");
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
  expect(read("src/app/(app)/layout.tsx").match(/<LocalShellHandoff\s*\/>/g)?.length).toBe(1);
  const prepare = read("src/components/WorkspacePrepare.tsx");
  expect(prepare).toContain("if (installed) announceShellReady();");
  expect(prepare).toContain("if (!localFirstOn()) for (const href of WARM_ROUTES) prefetch(href);");
  expect(read("src/lib/local-first/boot.ts")).toContain("if (shellNowReady) announceShellReady();");
});
