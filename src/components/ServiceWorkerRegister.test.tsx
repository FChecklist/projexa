/// <reference types="bun-types" />
// Found + fixed 2026-09-07, debugging a real dev-experience bug that had
// previously been misdiagnosed as an "isolated Turbopack dev-mode bug" (see
// CLAUDE.md's since-corrected note): sw.js's own CACHE_VERSION
// (src/app/sw.js/route.ts) falls back to the fixed literal string
// "local-dev" whenever VERCEL_GIT_COMMIT_SHA is unset -- true for every
// `bun run dev` run -- so its own activate handler's "delete any cache key
// that isn't today's CACHE_NAME" purge never fires locally: CACHE_NAME
// never changes between dev-server restarts even though Turbopack's
// dev-mode chunk contents do. A developer who ever had this service worker
// registered kept seeing "the module factory is not available" on
// /dashboard after any change touching AppSidebar.tsx's imports --
// surviving full `.next` cache deletes and complete `next dev` process
// restarts, because neither of those touches the browser's own Cache
// Storage. Confirmed directly via the browser: an active registration at
// scope http://localhost:3100/ was backing a cache literally named
// `projexa-shell-local-dev`; unregistering it and deleting that cache
// fixed the page immediately, with zero source changes needed to fix the
// *symptom* -- the *cause* is that the SW should never have been running
// in local dev at all (its own stated purpose -- a site worker opening
// PROJEXA with no signal in the field -- has zero meaning on localhost).
//
// This guards the fix in ServiceWorkerRegister.tsx: in development, the
// component must unregister any existing registration (self-healing for a
// developer who already has one from before this fix) and must never call
// register() itself; outside development, it must register the real
// /sw.js exactly as before.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Same guard as AttendanceCreateClient.test.tsx / project-scoped-page-error-isolation.test.tsx:
// bun test runs every file in one process, registering Happy DOM twice throws.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function stubServiceWorker() {
  const register = mock(async (_url: string) => ({}) as ServiceWorkerRegistration);
  const unregisterA = mock(async () => true);
  const unregisterB = mock(async () => true);
  const getRegistrations = mock(async () => [{ unregister: unregisterA }, { unregister: unregisterB }]);
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { register, getRegistrations },
    configurable: true,
  });
  return { register, getRegistrations, unregisterA, unregisterB };
}

function stubCaches(cacheNames: string[]) {
  const del = mock(async (_name: string) => true);
  Object.defineProperty(globalThis, "caches", {
    value: { keys: mock(async () => cacheNames), delete: del },
    configurable: true,
  });
  return { del };
}

// Flushes the promise chain inside the component's effect (getRegistrations
// -> Promise.all(unregister) -> caches.keys() -> Promise.all(caches.delete))
// without relying on fake timers -- a macrotask boundary drains the full
// microtask queue (including microtasks scheduled while draining) before
// running, so this reliably lets every .then() in that chain settle.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  cleanup();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("ServiceWorkerRegister -- never runs the SW in local dev", () => {
  test("development: unregisters every existing registration, deletes only projexa-shell-* caches, never calls register()", async () => {
    process.env.NODE_ENV = "development";
    const { register, getRegistrations, unregisterA, unregisterB } = stubServiceWorker();
    const { del } = stubCaches(["projexa-shell-local-dev", "some-unrelated-cache"]);

    render(<ServiceWorkerRegister />);
    await flush();
    await flush();

    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(unregisterA).toHaveBeenCalledTimes(1);
    expect(unregisterB).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("projexa-shell-local-dev");
    expect(del).not.toHaveBeenCalledWith("some-unrelated-cache");
    expect(register).not.toHaveBeenCalled();
  });

  test("production: registers the real /sw.js and never inspects existing registrations", async () => {
    process.env.NODE_ENV = "production";
    const { register, getRegistrations } = stubServiceWorker();

    render(<ServiceWorkerRegister />);
    await flush();

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(getRegistrations).not.toHaveBeenCalled();
  });
});
