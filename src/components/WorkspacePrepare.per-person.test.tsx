import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));

const { seenKey, shouldOfferPrepare } = await import("./WorkspacePrepare");
const { readyKey } = await import("@/lib/local-first/prepare-workspace");

// lf-e12 (found in a real browser, e2e/lf-lifecycle-session.spec.ts "two people on one laptop"): person A saw the first-run screen and
// signed out; person B signed in ON THE SAME TAB and was never offered it -- the "seen this session" key was one for the whole tab -- so
// B's workspace was never copied to the laptop. It is per person now.

class Mem {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe("who is offered the first-run 'Preparing your workspace' screen", () => {
  test("A has seen it this session; B, signing in on the same tab, is still offered it", () => {
    const local = new Mem();
    const session = new Mem();
    session.setItem(seenKey("person-a"), "1");
    expect(shouldOfferPrepare("person-a", local, session)).toBe(false);
    expect(shouldOfferPrepare("person-b", local, session)).toBe(true);
  });

  test("a person already prepared on this laptop is not offered it again", () => {
    const local = new Mem();
    local.setItem(readyKey("person-a"), "1");
    expect(shouldOfferPrepare("person-a", local, new Mem())).toBe(false);
    expect(shouldOfferPrepare("person-b", local, new Mem())).toBe(true);
  });

  test("the seen key names the person", () => {
    expect(seenKey("person-a")).not.toBe(seenKey("person-b"));
  });
});
