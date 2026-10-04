import { afterEach, describe, expect, test } from "bun:test";
import { waitForControl } from "./verified-install-browser";

// waitForControl: the page-side wait for "a service worker controls this page". A page that loaded while the worker was activating gets no
// controllerchange on its own (e2e/lf-lifecycle-install.spec.ts found it), so it must ask the worker to claim it.

const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function fakeNavigator() {
  const listeners = new Set<() => void>();
  const sw = {
    controller: null as unknown,
    addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
    fire() { listeners.forEach((fn) => fn()); },
  };
  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: sw }, configurable: true });
  return sw;
}
afterEach(() => { if (original) Object.defineProperty(globalThis, "navigator", original); });

describe("waitForControl", () => {
  test("already controlled: true at once, no claim", async () => {
    const sw = fakeNavigator();
    sw.controller = {};
    let claims = 0;
    expect(await waitForControl(async () => { claims += 1; }, 1000, 10)).toBe(true);
    expect(claims).toBe(0);
  });

  test("not controlled and no event comes: it asks the worker to claim, and the claim makes it controlled", async () => {
    const sw = fakeNavigator();
    let claims = 0;
    const ok = await waitForControl(async () => { claims += 1; sw.controller = {}; sw.fire(); }, 2000, 10);
    expect(ok).toBe(true);
    expect(claims).toBe(1);
  });

  test("a worker that never takes control: false after the timeout", async () => {
    fakeNavigator();
    expect(await waitForControl(async () => {}, 60, 10)).toBe(false);
  });
});
