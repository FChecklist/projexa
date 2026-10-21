/// <reference types="bun-types" />
// The guided panel: every part is there, "Fix it now" goes to the exact place with a way back, "Try again" only when honest, "Copy details" copies a
// complete plain-text report, and the occurrence is reported to the client log. No dialog anywhere.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

function setLocation(path: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`http://localhost:3000${path}`);
}


import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (u: string) => pushed.push(u), replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/permits/new",
}));
const reports: { kind: string; message: string }[] = [];
mock.module("@/lib/local-first/client-error-report", () => ({
  reportClientError: (kind: string, err: unknown) => reports.push({ kind, message: err instanceof Error ? err.message : String(err) }),
}));

const { GuidedError } = await import("./GuidedError");
const { listTrail } = await import("@/lib/error-guide/return-trail");
const { setUnmatchedLogger } = await import("@/lib/error-guide/match");
import type { Guide, GuideContext } from "@/lib/error-guide/types";

const ctx = (over: Partial<GuideContext> = {}): GuideContext => ({ route: "/permits/new", search: "?projectId=p1", projectId: "p1", method: "POST", apiPath: "/api/permits", ...over });

beforeEach(() => {
  pushed.length = 0;
  reports.length = 0;
  sessionStorage.clear();
  setUnmatchedLogger(() => {});
  setLocation("/permits/new?projectId=p1");
});
afterEach(() => {
  cleanup();
  setUnmatchedLogger();
});

const FIX_GUIDE: Guide = {
  id: "test-needs-currency",
  source: "prerequisite",
  match: { status: 400 },
  title: "A currency is needed first",
  what: "No base currency is set: {serverMessage}",
  why: "Money cannot be shown without one.",
  steps: ["Open Currencies.", "Mark one as the base currency.", "Come back with the strip at the top."],
  fix: { label: "Set the currency", to: "/finance/currencies", where: "Finance > Currencies > Base currency", focus: "base-currency" },
  retry: true,
  severity: "block",
  returnLabel: "Back to your new permit",
};

describe("GuidedError", () => {
  test("shows title, what, why, numbered steps, the place, and the three buttons -- as an inline alert, never a dialog", () => {
    const onRetry = mock(() => {});
    const { container, getByTestId } = render(<GuidedError ctx={ctx({ serverMessage: "no base currency" })} guide={FIX_GUIDE} onRetry={onRetry} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(getByTestId("guided-error-title").textContent).toBe("A currency is needed first");
    expect(getByTestId("guided-error-what").textContent).toBe("No base currency is set: no base currency");
    expect(getByTestId("guided-error-why").textContent).toContain("Money cannot be shown");
    const steps = getByTestId("guided-error-steps");
    expect(steps.tagName).toBe("OL");
    expect(steps.querySelectorAll("li").length).toBe(3);
    expect(getByTestId("guided-error-where").textContent).toContain("Finance > Currencies > Base currency");
    expect(getByTestId("guided-error-fix").textContent).toBe("Set the currency");
    expect(getByTestId("guided-error-retry").textContent).toContain("Try again");
    expect(getByTestId("guided-error-copy").textContent).toBe("Copy details");
  });

  test("'Fix it now' links to the exact place WITH a returnTo marker, leaves a way back (with the draft key), and navigates there", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx()} guide={FIX_GUIDE} draftKey="permit-new" />);
    const link = getByTestId("guided-error-fix") as HTMLAnchorElement;
    const href = link.getAttribute("href")!;
    expect(href.startsWith("/finance/currencies?")).toBe(true);
    const marker = new URLSearchParams(href.split("?")[1]).get("returnTo");
    expect(marker).toBeTruthy();
    expect(listTrail().length).toBe(0); // nothing is remembered until the person actually follows the link
    fireEvent.click(link);
    expect(pushed).toEqual([href]);
    const trail = listTrail();
    expect(trail.length).toBe(1);
    expect(trail[0]).toMatchObject({ id: marker, returnUrl: "/permits/new?projectId=p1", label: "your new permit", destination: "/finance/currencies", draftKey: "permit-new" });
  });

  test("a fix that is on THIS screen does not navigate and does not leave a trail: it highlights the field", () => {
    const g: Guide = { ...FIX_GUIDE, id: "t-same", fix: { label: "Fix it now", to: (c) => `${c.route}${c.search}`, where: "This screen", focus: "name" } };
    const { container, getByTestId } = render(
      <div>
        <GuidedError ctx={ctx()} guide={g} />
        <input id="name" data-testid="name-input" />
      </div>
    );
    fireEvent.click(getByTestId("guided-error-fix"));
    expect(pushed.length).toBe(0);
    expect(listTrail().length).toBe(0);
    expect(container.querySelector('[data-px-highlighted="true"]')).not.toBeNull();
  });

  test("'Try again' appears only when the guide allows it AND the screen supplied a way to retry (a screen can also override)", () => {
    const noRetry: Guide = { ...FIX_GUIDE, retry: false };
    const a = render(<GuidedError ctx={ctx()} guide={noRetry} onRetry={() => {}} />);
    expect(a.queryByTestId("guided-error-retry")).toBeNull();
    a.unmount();
    const b = render(<GuidedError ctx={ctx()} guide={FIX_GUIDE} />);
    expect(b.queryByTestId("guided-error-retry")).toBeNull();
    b.unmount();
    const c = render(<GuidedError ctx={ctx()} guide={noRetry} retryable onRetry={() => {}} />);
    expect(c.queryByTestId("guided-error-retry")).not.toBeNull();
  });

  test("'Try again' calls the screen's retry", () => {
    const onRetry = mock(() => {});
    const { getByTestId } = render(<GuidedError ctx={ctx()} guide={FIX_GUIDE} onRetry={onRetry} />);
    fireEvent.click(getByTestId("guided-error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("'Copy details' puts the COMPLETE plain-text report on the clipboard: guide id, screen, project, call, status, server words, steps", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void (copied = t) } });
    const { getByTestId } = render(<GuidedError ctx={ctx({ status: 400, serverMessage: "no base currency", apiPath: "/api/permits", method: "POST" })} guide={FIX_GUIDE} />);
    fireEvent.click(getByTestId("guided-error-copy"));
    await waitFor(() => expect(getByTestId("guided-error-copy").textContent).toBe("Copied"));
    for (const part of ["PROJEXA ERROR REPORT", "test-needs-currency", "/permits/new?projectId=p1", "Project: p1", "POST /api/permits", "Status: 400", "no base currency", "1. Open Currencies.", "3. Come back with the strip at the top.", "Finance > Currencies > Base currency"]) {
      expect(copied).toContain(part);
    }
  });

  test("the occurrence is reported to the client log, once per distinct failure", () => {
    const { rerender } = render(<GuidedError ctx={ctx({ serverMessage: "x" })} guide={FIX_GUIDE} />);
    rerender(<GuidedError ctx={ctx({ serverMessage: "x" })} guide={FIX_GUIDE} />);
    expect(reports.length).toBe(1);
    expect(reports[0].kind).toBe("guided-error");
    expect(reports[0].message).toContain("test-needs-currency");
    rerender(<GuidedError ctx={ctx({ serverMessage: "y" })} guide={FIX_GUIDE} />);
    expect(reports.length).toBe(2);
  });

  test("a quiet panel (a state of the screen, not a failure that just happened) is shown in full but never written to the device log", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx({ serverMessage: "x" })} guide={FIX_GUIDE} quiet />);
    expect(getByTestId("guided-error-title").textContent?.length).toBeGreaterThan(0);
    expect(reports.length).toBe(0);
  });

  test("with no guide given it looks one up: a timed-out write says it MAY HAVE BEEN SAVED and links to the list, not to the form", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx({ code: "TIMEOUT", status: 0 })} />);
    expect(getByTestId("guided-error").getAttribute("data-guide-id")).toBe("timeout-write");
    expect(getByTestId("guided-error-what").textContent?.toLowerCase()).toContain("may have been saved");
    expect(getByTestId("guided-error-fix").getAttribute("href")!.startsWith("/permits?projectId=p1&returnTo=")).toBe(true);
    expect(getByTestId("guided-error-where").textContent?.toLowerCase()).toContain("list");
  });

  test("the sign-in guide goes to /login with the whole current address as redirectTo, and needs no trail", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx({ status: 401 })} />);
    const href = getByTestId("guided-error-fix").getAttribute("href")!;
    expect(href).toBe(`/login?redirectTo=${encodeURIComponent("/permits/new?projectId=p1")}`);
    fireEvent.click(getByTestId("guided-error-fix"));
    expect(listTrail().length).toBe(0);
  });

  test("an unmatched failure still gets a complete panel: the server's words, a way back, Copy details", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx({ status: 418, serverMessage: "I am a teapot" })} onRetry={() => {}} />);
    expect(getByTestId("guided-error").getAttribute("data-guide-id")).toBe("generic-unknown");
    expect(getByTestId("guided-error-what").textContent).toContain("I am a teapot");
    expect(getByTestId("guided-error-retry")).not.toBeNull();
    expect(getByTestId("guided-error-fix").getAttribute("href")).toBe("/permits/new?projectId=p1");
    expect(getByTestId("guided-error-copy")).not.toBeNull();
  });

  test("a screen's own complete sentence replaces the one-line 'what', and the rest of the guide stays", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx({ code: "TIMEOUT", status: 0 })} message="The server did not answer in 10 s — it may have been saved." />);
    expect(getByTestId("guided-error-what").textContent).toBe("The server did not answer in 10 s — it may have been saved.");
    expect(getByTestId("guided-error-steps").querySelectorAll("li").length).toBeGreaterThan(0);
  });
});
