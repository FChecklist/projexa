/// <reference types="bun-types" />
// R67 FIX PASS -- useShellChain itself was never exercised.
//
// ChainDoor.test.tsx drives ShellChainProvider, so the WIRED case is covered.
// What was not is the case this module exists for: A PAGE RENDERED OUTSIDE THE
// SHELL. C-06 hands this handle to every routed screen, and those screens are
// also reachable on their own -- a create route opened directly, a page under
// test, a future embed. The default had to be a no-op that keeps the page
// working rather than a throw, and nothing asserted that it is.
//
// The second property is the one that makes the handle safe to hand out at
// all: THERE IS NO WAY TO EXPRESS EXECUTION THROUGH IT. loadChain fills the
// strip, openDoor fills it and navigates, pushReceipt reports a save that has
// already happened. None of them can run a write, and the surface is small
// enough to assert exhaustively -- which is what stops a later member being
// added that can.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ShellChainProvider, useShellChain, type ShellChainApi } from "./shell-chain-context";

afterEach(cleanup);

/** Renders a probe under an optional provider and returns what it saw. */
function readHandle(value?: ShellChainApi) {
  let seen: ShellChainApi | null = null;
  function Probe() {
    seen = useShellChain();
    return <span>probe</span>;
  }
  render(value ? <ShellChainProvider value={value}><Probe /></ShellChainProvider> : <Probe />);
  if (!seen) throw new Error("the probe never rendered");
  return seen as ShellChainApi;
}

describe("*** A PAGE OUTSIDE THE SHELL STILL WORKS ***", () => {
  test("with no provider the handle says so rather than throwing", () => {
    const api = readHandle();
    // hasShell is the whole point: a page can ask "is there a strip above me?"
    // and draw a plain button instead of one that does nothing at all.
    expect(api.hasShell).toBe(false);
  });

  test("every member is callable and every one is a no-op", () => {
    const api = readHandle();
    // No throw, no return value to mistake for success.
    expect(api.loadChain({ mode: "projects", segments: [] } as never)).toBeUndefined();
    expect(api.openDoor("labour.mark-attendance")).toBeUndefined();
    expect(api.openDoor("labour.mark-attendance", { projectId: "p1", navigate: false })).toBeUndefined();
    expect(api.pushReceipt({ text: "Saved" } as never)).toBeUndefined();
  });
});

describe("under a shell the handle is the shell's own", () => {
  test("hasShell is true and each call reaches the provider verbatim", () => {
    const calls: string[] = [];
    const value: ShellChainApi = {
      hasShell: true,
      loadChain: () => calls.push("loadChain"),
      openDoor: (id) => calls.push(`openDoor:${id}`),
      pushReceipt: () => calls.push("pushReceipt"),
    };
    const api = readHandle(value);

    expect(api.hasShell).toBe(true);
    api.loadChain({ mode: "projects", segments: [] } as never);
    api.openDoor("labour.mark-attendance");
    api.pushReceipt({ text: "Saved" } as never);
    expect(calls).toEqual(["loadChain", "openDoor:labour.mark-attendance", "pushReceipt"]);
  });
});

describe("*** THE HANDLE CANNOT EXPRESS EXECUTION ***", () => {
  test("its surface is exactly four members, and none of them writes", () => {
    const api = readHandle();
    // Exhaustive on purpose. A fifth member is a deliberate act, and this
    // test is where someone adding one has to say what it does -- which is
    // how "loadChain never executes" stays true of the whole handle rather
    // than of one function.
    expect(Object.keys(api).sort()).toEqual(["hasShell", "loadChain", "openDoor", "pushReceipt"]);
    expect(typeof api.loadChain).toBe("function");
    expect(typeof api.openDoor).toBe("function");
    expect(typeof api.pushReceipt).toBe("function");
  });
});
