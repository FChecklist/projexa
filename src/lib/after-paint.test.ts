/// <reference types="bun-types" />
// R67 F-09 (R-122) -- sibling test for after-paint.ts.
//
// Two properties, both of which a naive implementation gets wrong:
//
//  1. ONE requestAnimationFrame is not "after paint" -- it runs BEFORE the
//     paint it is scheduled for. This must wait for the SECOND frame.
//  2. Cancelling must actually stop the work, including when the cancel lands
//     between the two frames. A React effect cleanup that does not really
//     cancel produces a fetch into an unmounted component.
import { afterEach, describe, expect, test } from "bun:test";
import { afterFirstPaint } from "./after-paint";

type Frame = () => void;

const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

function installFrameClock() {
  const pending = new Map<number, Frame>();
  let nextHandle = 1;
  globalThis.requestAnimationFrame = ((cb: Frame) => {
    const handle = nextHandle++;
    pending.set(handle, cb);
    return handle;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => {
    pending.delete(handle);
  }) as typeof cancelAnimationFrame;

  return function paintOneFrame() {
    const due = [...pending.entries()];
    pending.clear();
    for (const [, cb] of due) cb();
  };
}

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
});

describe("afterFirstPaint", () => {
  test("does not run on the first frame -- that one is still before the paint", () => {
    const paint = installFrameClock();
    let ran = false;

    afterFirstPaint(() => { ran = true; });
    paint();

    expect(ran).toBe(false);
  });

  test("runs on the second frame, i.e. once the browser has painted", () => {
    const paint = installFrameClock();
    let ran = false;

    afterFirstPaint(() => { ran = true; });
    paint();
    paint();

    expect(ran).toBe(true);
  });

  test("cancelling before either frame stops it entirely", () => {
    const paint = installFrameClock();
    let ran = false;

    afterFirstPaint(() => { ran = true; })();
    paint();
    paint();

    expect(ran).toBe(false);
  });

  test("cancelling BETWEEN the two frames stops it -- the unmount-mid-flight case", () => {
    const paint = installFrameClock();
    let ran = false;

    const cancel = afterFirstPaint(() => { ran = true; });
    paint();
    cancel();
    paint();

    expect(ran).toBe(false);
  });

  test("with no requestAnimationFrame at all (server render, test env) it still runs, as a macrotask", async () => {
    // @ts-expect-error -- deliberately removing the API to exercise the fallback
    globalThis.requestAnimationFrame = undefined;
    let ran = false;

    afterFirstPaint(() => { ran = true; });
    expect(ran).toBe(false); // never synchronous

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ran).toBe(true);
  });

  test("the fallback is cancellable too", async () => {
    // @ts-expect-error -- deliberately removing the API to exercise the fallback
    globalThis.requestAnimationFrame = undefined;
    let ran = false;

    afterFirstPaint(() => { ran = true; })();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ran).toBe(false);
  });
});
