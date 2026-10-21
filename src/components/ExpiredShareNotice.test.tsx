/// <reference types="bun-types" />
// GUIDED ERRORS G3: a shared link that no longer opens (report, attendance summary, minutes) is the full guide, not a bare "not found".
// Also the "your earlier entries were put back" note shown above a restored form.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/share/report/abc",
}));
mock.module("@/lib/local-first/client-error-report", () => ({ reportClientError: () => {} }));

const { ExpiredShareNotice } = await import("./ExpiredShareNotice");
const { DraftRestoredNote } = await import("./DraftRestoredNote");

afterEach(() => cleanup());

describe("ExpiredShareNotice", () => {
  for (const [kind, id] of [
    ["report", "report-share-expired"],
    ["attendance", "report-share-expired"],
    ["mom", "mom-link-expired"],
  ] as const) {
    test(`${kind}: the public page shows the complete guide (${id})`, () => {
      const { getByTestId } = render(<ExpiredShareNotice kind={kind} token="tok" />);
      const panel = getByTestId("guided-error");
      expect(panel.getAttribute("data-guide-id")).toBe(id);
      expect(getByTestId("guided-error-title").textContent?.trim().length).toBeGreaterThan(0);
      expect(getByTestId("guided-error-why").textContent?.trim().length).toBeGreaterThan(0);
      expect(getByTestId("guided-error-steps").querySelectorAll("li").length).toBeGreaterThanOrEqual(1);
      expect(getByTestId("guided-error-what").textContent).toContain("ask the sender for a new one");
    });
  }
});

describe("DraftRestoredNote", () => {
  test("says nothing unless something was put back, and Start fresh throws it away", () => {
    const none = render(<DraftRestoredNote draft={{ restored: false, startFresh: () => {} }} />);
    expect(none.queryByTestId("draft-restored")).toBeNull();
    none.unmount();

    let fresh = 0;
    const some = render(<DraftRestoredNote draft={{ restored: true, startFresh: () => { fresh += 1; } }} />);
    expect(some.getByTestId("draft-restored").textContent).toContain("put back");
    fireEvent.click(some.getByTestId("draft-start-fresh"));
    expect(fresh).toBe(1);
  });
});
