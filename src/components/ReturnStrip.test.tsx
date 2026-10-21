/// <reference types="bun-types" />
// The way back: the strip shows on the destination screen, goes back with one tap (consuming the entry), is always dismissible, survives a reload,
// becomes the stronger "You can go back now" after a save, and ?focus= scrolls to and outlines the element for 3 s with an announcement.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

function setLocation(path: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`http://localhost:3000${path}`);
}


import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

const pushed: string[] = [];
let pathname = "/finance/currencies";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (u: string) => pushed.push(u), replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => pathname,
}));

const { ReturnStrip } = await import("./ReturnStrip");
const { listTrail, markReturnReady, pushReturn } = await import("@/lib/error-guide/return-trail");
const { LIVE_REGION_ID } = await import("@/lib/error-guide/focus");

beforeEach(() => {
  pushed.length = 0;
  pathname = "/finance/currencies";
  sessionStorage.clear();
  document.getElementById(LIVE_REGION_ID)?.remove();
  setLocation("/finance/currencies");
});
afterEach(cleanup);

function arrive(): string {
  const e = pushReturn({ returnUrl: "/permits/new?projectId=p1", label: "your new permit", destination: "/finance/currencies", draftKey: "permit-new" });
  setLocation(`/finance/currencies?returnTo=${e.id}`);
  return e.id;
}

describe("ReturnStrip", () => {
  test("renders nothing without a trail", () => {
    const { container } = render(<ReturnStrip />);
    expect(container.querySelector('[data-testid="return-strip"]')).toBeNull();
  });

  test("shows 'Back to <label>' on the destination screen; one tap goes back to the exact address and consumes the entry", () => {
    arrive();
    const { getByTestId } = render(<ReturnStrip />);
    expect(getByTestId("return-strip-back").textContent).toContain("Back to your new permit");
    fireEvent.click(getByTestId("return-strip-back"));
    expect(pushed).toEqual(["/permits/new?projectId=p1"]);
    expect(listTrail().length).toBe(0);
    expect(document.querySelector('[data-testid="return-strip"]')).toBeNull();
  });

  test("'Stay here' dismisses it and consumes the entry without going anywhere -- the person is never trapped", () => {
    arrive();
    const { getByTestId } = render(<ReturnStrip />);
    fireEvent.click(getByTestId("return-strip-stay"));
    expect(pushed.length).toBe(0);
    expect(listTrail().length).toBe(0);
    expect(document.querySelector('[data-testid="return-strip"]')).toBeNull();
  });

  test("survives a reload: a fresh mount finds the same entry, with or without the marker in the address", () => {
    arrive();
    render(<ReturnStrip />).unmount();
    expect(render(<ReturnStrip />).queryByTestId("return-strip")).not.toBeNull();
    cleanup();
    setLocation("/finance/currencies");
    expect(render(<ReturnStrip />).queryByTestId("return-strip")).not.toBeNull();
  });

  test("does not appear on an unrelated screen", () => {
    arrive();
    pathname = "/vendors";
    setLocation("/vendors");
    expect(render(<ReturnStrip />).queryByTestId("return-strip")).toBeNull();
  });

  test("after something is saved on the destination it becomes the stronger 'You can go back now: <label>'", () => {
    arrive();
    const { getByTestId } = render(<ReturnStrip />);
    expect(getByTestId("return-strip").getAttribute("data-ready")).toBe("false");
    act(() => markReturnReady("/finance/currencies"));
    expect(getByTestId("return-strip").getAttribute("data-ready")).toBe("true");
    expect(getByTestId("return-strip-text").textContent).toBe("You can go back now: your new permit");
  });
});

describe("?focus= on arrival", () => {
  test("scrolls to the element, outlines it, announces it, and removes the outline after 3 seconds", async () => {
    setLocation("/finance/currencies?focus=base-currency");
    document.body.innerHTML = '<div data-testid="base-currency" id="bc">Base currency</div>';
    let scrolled = 0;
    (document.getElementById("bc") as HTMLElement).scrollIntoView = () => void (scrolled += 1);
    render(<ReturnStrip />);
    const el = document.getElementById("bc") as HTMLElement;
    expect(scrolled).toBe(1);
    expect(el.getAttribute("data-px-highlighted")).toBe("true");
    expect(el.style.outline).toContain("3px");
    const live = document.getElementById(LIVE_REGION_ID)!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Highlighted");
    await new Promise((r) => setTimeout(r, 3100));
    expect(el.getAttribute("data-px-highlighted")).toBeNull();
    expect(el.style.outline).toBe("");
  });

  test("waits for an element that is still being drawn", async () => {
    setLocation("/finance/currencies?focus=late-field");
    render(<ReturnStrip />);
    const late = document.createElement("input");
    late.id = "late-field";
    late.scrollIntoView = () => {};
    document.body.appendChild(late);
    await new Promise((r) => setTimeout(r, 250));
    expect(late.getAttribute("data-px-highlighted")).toBe("true");
  });
});
