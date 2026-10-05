// LOCAL-FIRST R10 ("the app is not deleted until the person chooses") at the sign-out.
//
// What a sign-out may remove: the person's identity, the person's workspace database (when nothing is pending), the person's
// RELEASE caches (`px-release-*`) and the worker's pointer, so the next person on the laptop starts from nothing. AUDIT-100 A3 (step 1b):
// by default the release cache is KEPT, marked signed out (online no shell is served from it; offline it opens the passcode sign-in, B20), for the same person's next sign-in; another person's
// sign-in deletes it (the tests at the end of this file). What it must NOT
// remove: the service worker registration (the installed app's offline engine), any other cache, the installed app itself. The
// release is re-installed silently at the next sign-in (persistence.test.tsx: "SILENT RE-INSTALL").
//
// Also guarded here: LocalFirstBoot -- persistent storage request, install-prompt capture, silent re-install -- is mounted on every
// signed-in page (root layout, which wraps the (app) group) exactly once.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { openDeviceMeta } from "./device-meta";
import { createIdentityStore, resetDeliberateSignOutForTests } from "./identity";
import { createSwCore } from "./release/sw-core";
import { RELEASE_CACHE_PREFIX, SHELL_URL, SW_META_CACHE, SW_POINTER_URL, releaseCacheName } from "./release/release-constants";
import { FakeCacheStorage } from "./release/__fixtures__/fakes";
import { createSwClient } from "./release/sw-client";
import { signOutEverywhere } from "./sign-out-everywhere";

const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("R10: a sign-out never deletes the app", () => {
  test("end to end: the worker receives ONLY CLEAR_PERSON; the registration is never unregistered", async () => {
    resetDeliberateSignOutForTests();
    const sent: Record<string, unknown>[] = [];
    let unregistered = 0;
    const controller = {
      postMessage(message: Record<string, unknown>, transfer: Transferable[]) {
        sent.push(message);
        (transfer[0] as unknown as MessagePort).postMessage({ ok: true, type: message.type });
      },
    };
    const registration = { active: controller, unregister: async () => { unregistered += 1; return true; } };
    const container = { controller, getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) };
    const idb = new IDBFactory();
    const store = createIdentityStore({ openMeta: () => openDeviceMeta(idb) });
    await store.write({ userId: "u1", email: null, name: null, orgId: null, role: null, lastRefreshAt: 1, signedInAt: 1, session: { access_token: "a", refresh_token: "r", expires_at: null } });

    await signOutEverywhere({
      auth: { signOut: async () => ({ error: null }) },
      store,
      sw: createSwClient({ container }),
      clearBrowserSession: () => {},
      finishWorkspace: async () => ({ pending: 0, wiped: true, notice: null }),
    });
    // the default sign-out keeps the (public) release for this person's next sign-in: no shell served online meanwhile (offline it opens the passcode sign-in, B20) (AUDIT-100 A3, step 1b)
    expect(sent).toEqual([{ type: "CLEAR_PERSON", personId: "u1", keepRelease: true }]);
    expect(unregistered).toBe(0);
    resetDeliberateSignOutForTests();
  });

  test("the worker's CLEAR_PERSON removes the person's release caches and pointer, and NOTHING else", async () => {
    const caches = new FakeCacheStorage();
    const scope = {
      location: { origin: "https://projexa.test" },
      navigator: { onLine: true },
      caches,
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      fetch: async () => new Response("network"),
    };
    const core = createSwCore(scope as never, {
      releaseCachePrefix: RELEASE_CACHE_PREFIX, metaCache: SW_META_CACHE, pointerUrl: SW_POINTER_URL, shellUrl: SHELL_URL,
      publicExact: [], publicPrefixes: [], serverPageParam: "__server", legacyCachePrefixes: [],
    });
    await (await caches.open(releaseCacheName("2026.10.02-001"))).put(SHELL_URL, new Response("<html/>"));
    await (await caches.open("some-other-cache")).put("/x", new Response("kept"));
    const replies: unknown[] = [];
    let pending: Promise<unknown> | undefined;
    core.onMessage({ data: { type: "USE_RELEASE", version: "2026.10.02-001", personId: "u1" }, ports: [{ postMessage: (m) => replies.push(m) }], waitUntil: (p) => { pending = p; } });
    await pending;
    core.onMessage({ data: { type: "CLEAR_PERSON", personId: "u1" }, ports: [{ postMessage: (m) => replies.push(m) }], waitUntil: (p) => { pending = p; } });
    await pending;
    expect(replies.at(-1)).toMatchObject({ ok: true, cleared: true });
    expect(await caches.keys()).toEqual(["some-other-cache"]);
  });

  test("A3 step 1b + B20: CLEAR_PERSON keepRelease keeps the release cache; online it serves no shell, offline it opens the shell (passcode sign-in); the same person gets it back, another person never does", async () => {
    const caches = new FakeCacheStorage();
    const fetched: string[] = [];
    const scope = {
      location: { origin: "https://projexa.test" },
      navigator: { onLine: true },
      caches,
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      fetch: async (r: Request | string) => { fetched.push(typeof r === "string" ? r : r.url); return new Response("network"); },
    };
    const core = createSwCore(scope as never, {
      releaseCachePrefix: RELEASE_CACHE_PREFIX, metaCache: SW_META_CACHE, pointerUrl: SW_POINTER_URL, shellUrl: SHELL_URL,
      publicExact: ["/login"], publicPrefixes: [], serverPageParam: "px-server", legacyCachePrefixes: [],
    });
    const V = "2026.10.05-001";
    const release = await caches.open(releaseCacheName(V));
    await release.put(SHELL_URL, new Response("<html>shell</html>"));
    await release.put("/_next/static/a.js", new Response("js"));
    const send = async (data: Record<string, unknown>) => {
      const replies: Record<string, unknown>[] = [];
      let pending: Promise<unknown> | undefined;
      core.onMessage({ data, ports: [{ postMessage: (m) => replies.push(m as Record<string, unknown>) }], waitUntil: (p) => { pending = p; } });
      await pending;
      return replies.at(-1)!;
    };
    const navigate = async (path: string) => {
      let answer: Promise<Response> | Response | undefined;
      core.onFetch({ request: new Request(`https://projexa.test${path}`, { mode: "navigate" as RequestMode }) as Request, respondWith: (p) => { answer = p; } });
      return (await answer!).text();
    };
    expect(await send({ type: "USE_RELEASE", version: V, personId: "u1", localFirst: true })).toMatchObject({ ok: true });
    expect(await navigate("/dashboard")).toBe("<html>shell</html>");

    // u1 signs out (the default): the cache stays; online the worker answers no navigation with its shell
    expect(await send({ type: "CLEAR_PERSON", personId: "u1", keepRelease: true })).toMatchObject({ ok: true, cleared: true, keptRelease: V });
    expect(await caches.keys()).toContain(releaseCacheName(V));
    expect(await send({ type: "STATUS" })).toMatchObject({ version: null, signedOut: true, keptVersion: V, personId: "u1" });
    expect(await navigate("/dashboard")).toBe("network");
    expect(await navigate("/login")).toBe("network");
    // B20: with NO network the kept release opens the shell (its signed-out screen is the offline passcode sign-in), for /login too
    scope.navigator.onLine = false;
    expect(await navigate("/login")).toBe("<html>shell</html>");
    expect(await navigate("/dashboard")).toBe("<html>shell</html>");
    scope.navigator.onLine = true;
    // a pass with nobody known does not wake it up
    expect(await send({ type: "USE_RELEASE", version: V })).toMatchObject({ ok: true });
    expect(await send({ type: "STATUS" })).toMatchObject({ version: null, signedOut: true });
    expect(await navigate("/dashboard")).toBe("network");

    // u1 signs in again: the same cache is active again, nothing downloaded
    expect(await send({ type: "USE_RELEASE", version: V, personId: "u1", localFirst: true })).toMatchObject({ ok: true });
    expect(await send({ type: "STATUS" })).toMatchObject({ version: V, signedOut: false, personId: "u1" });
    expect(await navigate("/dashboard")).toBe("<html>shell</html>");

    // u1 signs out again; u2 signs in: u1's kept release is deleted, by SET_PERSON or by USE_RELEASE
    await send({ type: "CLEAR_PERSON", personId: "u1", keepRelease: true });
    expect(await send({ type: "USE_RELEASE", version: V, personId: "u2", localFirst: true })).toMatchObject({ ok: false, error: "other_person" });
    expect(await caches.keys()).toEqual([]);
    expect(await send({ type: "STATUS" })).toMatchObject({ version: null, personId: null, signedOut: false });
  });

  test("A3 step 1b: the explicit 'delete this laptop's copy' sends no keepRelease (everything is deleted), the default sign-out does", async () => {
    for (const deleteLocalCopy of [false, true]) {
      resetDeliberateSignOutForTests();
      const sent: Record<string, unknown>[] = [];
      const controller = {
        postMessage(message: Record<string, unknown>, transfer: Transferable[]) {
          sent.push(message);
          (transfer[0] as unknown as MessagePort).postMessage({ ok: true, type: message.type });
        },
      };
      const registration = { active: controller, unregister: async () => true };
      const container = { controller, getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) };
      const idb = new IDBFactory();
      const store = createIdentityStore({ openMeta: () => openDeviceMeta(idb) });
      await store.write({ userId: "u1", email: null, name: null, orgId: null, role: null, lastRefreshAt: 1, signedInAt: 1, session: { access_token: "a", refresh_token: "r", expires_at: null } });
      await signOutEverywhere({
        auth: { signOut: async () => ({ error: null }) }, store, sw: createSwClient({ container }), clearBrowserSession: () => {},
        deleteLocalCopy, finishWorkspace: async () => ({ pending: 0, wiped: deleteLocalCopy, notice: null }),
      });
      expect(sent).toEqual([deleteLocalCopy ? { type: "CLEAR_PERSON", personId: "u1" } : { type: "CLEAR_PERSON", personId: "u1", keepRelease: true }]);
    }
    resetDeliberateSignOutForTests();
  });

  test("no sign-out code unregisters the worker, deletes caches by itself, or touches the install state", () => {
    const files = [
      "src/lib/local-first/sign-out-everywhere.ts",
      "src/lib/local-first/sign-out.ts",
      "src/lib/local-first/identity.ts",
      "src/components/shell/AccountMenu.tsx",
      "src/components/AppTopbar.tsx",
      "src/components/SettingsClient.tsx",
    ];
    for (const rel of files) {
      const source = code(read(rel));
      for (const forbidden of [/\.unregister\s*\(/, /getRegistrations\s*\(/, /\bcaches\s*\.\s*(delete|keys)\s*\(/, /META_KEYS\s*\.\s*(release|install|persistence)/]) {
        expect({ rel, hit: forbidden.test(source) }).toEqual({ rel, hit: false });
      }
    }
  });
});

describe("R10: LocalFirstBoot runs on every signed-in page", () => {
  test("the root layout (which wraps the (app) group) mounts it exactly once, and the (app) layout does not mount a second", () => {
    const root = code(read("src/app/layout.tsx"));
    expect(root).toContain('import { LocalFirstBoot } from "@/components/local-first/LocalFirstBoot"');
    expect(root.match(/<LocalFirstBoot\s*\/>/g)?.length).toBe(1);
    expect(code(read("src/app/(app)/layout.tsx"))).not.toContain("LocalFirstBoot");
  });

  test("LocalFirstBoot starts the boot, and the boot wires persistent storage, the install prompt and the release check", () => {
    expect(code(read("src/components/local-first/LocalFirstBoot.tsx"))).toContain("m.startLocalFirstBoot()");
    const boot = code(read("src/lib/local-first/boot.ts"));
    for (const step of ["sharedInstallPrompt(", "ensurePersistence(", "runLocalFirstBoot(", "startIdentityMirror(", "restoreSessionIfMissing("]) expect(boot).toContain(step);
  });
});
