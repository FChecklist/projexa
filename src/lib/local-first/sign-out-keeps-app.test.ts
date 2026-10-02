// LOCAL-FIRST R10 ("the app is not deleted until the person chooses") at the sign-out.
//
// What a sign-out may remove: the person's identity, the person's workspace database (when nothing is pending), the person's
// RELEASE caches (`px-release-*`) and the worker's pointer, so the next person on the laptop starts from nothing. What it must NOT
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
    expect(sent).toEqual([{ type: "CLEAR_PERSON", personId: "u1" }]);
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
