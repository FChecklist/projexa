/// <reference types="bun-types" />
// R67 E-36 (R-268). The Work Progress Report's header action group.
//
// The item's own acceptance is Playwright (a real download event, a real new
// tab), which this lane may not run. What CAN be proved without a server is
// proved here against the real component tree in a real DOM:
//
//   * the five controls exist in E-36's stated order;
//   * before a run they are DISABLED and their ACCESSIBLE NAME carries the
//     reason -- "Export PDF (run the report first)" -- which is the half a
//     title attribute alone silently failed (the accessible-name algorithm
//     prefers text content over title, so the name was just "Export PDF");
//   * after a run Export PDF is a real anchor at the relay the compliance
//     tracker serves, with a project-named download attribute rather than the
//     raw project id;
//   * Share via WhatsApp creates a link through the SAME share endpoint Copy
//     link uses and opens wa.me with the report named and the period spelled
//     out.
//
// Same happy-dom + @testing-library/react harness as the sibling views test.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/work-progress",
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

import { cleanup, render, waitFor } from "@testing-library/react";
import WorkProgressReportClient from "./WorkProgressReportClient";

const TOUCHED = { prev: true, current: true, total: true };

function row(id: string, amtTotal: number) {
  return {
    lineItemId: id,
    code: id.toUpperCase(),
    description: `Line ${id}`,
    categoryName: "Civil",
    unit: "Sqm",
    rate: 100,
    qtyTotal: amtTotal / 100,
    amtTotal,
    parentLineItemId: null,
    qty: { prev: 1, current: 1, total: 2, balance: 0 },
    amt: { prev: 100, current: 100, total: 200, balance: amtTotal - 200 },
    percentage: { prev: 10, current: 10, total: 20, balance: 80 },
    touched: TOUCHED,
  };
}

/** byCategory has to TIE to the rows or the component blocks every export (checkTies). */
function reportBody() {
  return {
    boqTitle: "BOQ v3",
    boqId: "boq-3",
    availableBoqs: [{ id: "boq-3", title: "BOQ", status: "active", version: 3 }],
    rows: [row("a", 1000), row("b", 500)],
    byCategory: [
      {
        name: "Civil",
        amtTotal: 1500,
        amt: { prev: 200, current: 200, total: 400, balance: 1100 },
        percentage: { prev: 13.33, current: 13.33, total: 26.67, balance: 73.33 },
      },
    ],
    byManpower: [],
    byVendor: [],
    availableCategories: ["Civil"],
    from: "2026-08-01",
    to: "2026-09-03",
  };
}

let opened: string[] = [];

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  cleanup();
  opened = [];
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function renderReport() {
  return render(
    <WorkProgressReportClient
      projectId="prj-cedar"
      projectName="Cedar Heights Villa - Phase 1"
      initialFrom="2026-08-01"
      initialTo="2026-09-03"
    />
  );
}

/** The five footer controls, in DOM order, by their visible label. */
function footerLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button, a"))
    .map((el) => el.textContent?.trim() ?? "")
    .filter((text) =>
      ["Share", "Share via WhatsApp", "Export CSV", "Export XLSX", "Export PDF"].includes(text)
    );
}

function control(container: HTMLElement, label: string): HTMLElement {
  const match = Array.from(container.querySelectorAll("button, a")).find(
    (el) => el.textContent?.trim() === label
  );
  if (!match) throw new Error(`no control labelled "${label}"`);
  return match as HTMLElement;
}

describe("R67 E-36: the header action group", () => {
  test("Share | Share via WhatsApp | Export CSV | Export XLSX | Export PDF, in that order", async () => {
    stubFetch(() => ok(reportBody()));
    const { container } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));

    expect(footerLabels(container)).toEqual([
      "Share",
      "Share via WhatsApp",
      "Export CSV",
      "Export XLSX",
      "Export PDF",
    ]);
    // E-28's wording for this control is retired, not left beside the new one.
    expect(container.textContent).not.toContain("Send on WhatsApp");
  });

  test("before a result exists, Export PDF is disabled and SAYS WHY in its accessible name", async () => {
    // A request that never settles: the run is in flight, so there is no result.
    stubFetch(() => new Promise<Response>(() => {}) as unknown as Response);
    const { container } = renderReport();

    await waitFor(() => expect(control(container, "Export PDF")).toBeTruthy());
    const pdf = control(container, "Export PDF") as HTMLButtonElement;
    expect(pdf.tagName).toBe("BUTTON");
    expect(pdf.disabled).toBe(true);
    expect(pdf.getAttribute("aria-label")).toContain("run the report first");
    expect(pdf.getAttribute("title")).toContain("run the report first");
  });

  test("after a run, Export PDF is an anchor at the relay, named after the project", async () => {
    stubFetch(() => ok(reportBody()));
    const { container } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));

    const pdf = control(container, "Export PDF") as HTMLAnchorElement;
    expect(pdf.tagName).toBe("A");
    // The relay, never VERIDIAN directly -- the browser must not carry the org
    // API key (E-36's own reason for the proxy).
    expect(pdf.getAttribute("href")).toContain("/api/work-progress/report/pdf?");
    expect(pdf.getAttribute("href")).toContain("projectId=prj-cedar");
    expect(pdf.getAttribute("download")).toBe(
      "cedar-heights-villa-phase-1-work-progress-2026-08-01-2026-09-03.pdf"
    );
    // Not the raw id, which is what the CSV used to save under.
    expect(pdf.getAttribute("download")).not.toContain("prj-cedar");
  });

  test("Share via WhatsApp opens wa.me with the report named, the period spelled out and the share link", async () => {
    stubFetch((url) => {
      if (url.includes("/api/work-progress/report/share")) {
        return ok({ url: "https://projexa-ai.com/share/wpr/tok_123" });
      }
      return ok(reportBody());
    });
    globalThis.open = ((target: string) => {
      opened.push(target);
      return null;
    }) as unknown as typeof globalThis.open;

    const { container } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));

    (control(container, "Share via WhatsApp") as HTMLButtonElement).click();
    await waitFor(() => expect(opened).toHaveLength(1));

    const target = decodeURIComponent(opened[0]);
    expect(target.startsWith("https://wa.me/?text=")).toBe(true);
    expect(target).toContain("Work Progress Report");
    expect(target).toContain("Cedar Heights Villa - Phase 1");
    expect(target).toContain("https://projexa-ai.com/share/wpr/tok_123");
  });
});
