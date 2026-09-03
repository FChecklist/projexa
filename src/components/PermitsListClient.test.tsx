/// <reference types="bun-types" />
// R67 D-65 / D-59 / D-71's shared acceptance, run as a real render instead
// of as a Playwright run against a dev server:
//
//   "with /api/permits stubbed to 500: the page shows 'Couldn't load
//    permits' and a 'Retry' button and does NOT contain 'No permits yet for
//    this project.'; with the same route stubbed to [] the empty sentence is
//    shown instead."
//
// The second half is the point. Before this change the fetch was
// `.then(r => r.json()).then(d => setPermits(d.permits ?? []))` with the
// status never read, so a 500 produced an empty array and the kit's
// ListScreen printed "0 records" and "No permits yet for this project." on a
// project that has permits.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/permits",
}));

const PermitsListClient = (await import("./PermitsListClient")).default;

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof globalThis.fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const PROPS = { projectId: "p-cedar", projectName: "Cedar Heights Villa - Phase 1" };

describe("PermitsListClient", () => {
  test("a 500 shows the failure and NEVER the empty sentence", async () => {
    stubFetch(500, { error: "Something went wrong upstream." });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load permits");
    });
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("No permits yet for this project.");
    // The record count is an en-dash, never "0 records".
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("0 records");
  });

  test("a 504 is named as a timeout, from the shared dictionary", async () => {
    stubFetch(504, { error: "The construction data service did not respond in time. Please retry." });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("UPSTREAM_TIMEOUT");
    });
    expect(container.textContent).toContain("Couldn't load permits — the construction data service didn't answer");
    expect(container.textContent).not.toContain("No permits yet");
  });

  test("a 401 says so and offers no Retry, because retrying will not fix a permission", async () => {
    stubFetch(401, { error: "Unauthorized" });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("NOT_AUTHORISED");
    });
    expect(container.textContent).not.toContain("No permits yet");
    const retry = Array.from(container.querySelectorAll("button")).filter((b) => (b.textContent ?? "").includes("Retry"));
    expect(retry).toHaveLength(0);
  });

  test("only a 200 with zero rows shows the empty sentence, with its primary action", async () => {
    stubFetch(200, { permits: [] });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No permits yet for this project.");
    });
    expect(container.textContent).not.toContain("Couldn't load permits");
    expect(container.textContent).toContain("0 records");
  });

  test("rows render and the count becomes real", async () => {
    stubFetch(200, {
      permits: [
        {
          id: "pm1",
          name: "Building permit",
          permitNumber: "BP-2026-0142",
          permitAuthority: "Dubai Municipality",
          issueDate: "2026-01-01",
          endDate: "2026-12-31",
          daysToExpiry: 120,
        },
      ],
    });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("BP-2026-0142");
    });
    expect(container.textContent).toContain("1 record");
    expect(container.textContent).not.toContain("No permits yet");
  });

  // R67 D-59: "'(Not yet available)' replaced by a real reason such as
  // 'Export - no rows to export'." Both header controls carried the literal
  // placeholder while the shared ListHeaderActions on Labour, Materials and
  // Schedule said something real -- two conventions for the same disabled
  // control on one product. Asserted so it cannot drift back.
  test("a disabled header control gives a real reason, never the placeholder", async () => {
    stubFetch(200, { permits: [] });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No permits yet for this project.");
    });
    expect(container.innerHTML).not.toContain("Not yet available");
    // R67 E-18 (R-178), merged 2026-09-03: a disabled control must name WHERE
    // the capability really is, not merely that it is absent. "Filtering
    // permits is not built yet" told a reader nothing they could act on; this
    // sends them to the screen that has the view they came for.
    expect(container.innerHTML).toContain("the expiring-soon view is reached from the Dashboard");
    // With no rows on screen, Export names the reason it has TODAY.
    expect(container.innerHTML).toContain("Export — no rows to export");
  });

  test("with rows on screen, Export's reason names where exports live -- not that there is nothing to export", async () => {
    stubFetch(200, {
      permits: [
        {
          id: "pm1",
          name: "Building permit",
          permitNumber: "BP-2026-0142",
          permitAuthority: "Dubai Municipality",
          issueDate: "2026-01-01",
          endDate: "2026-12-31",
          daysToExpiry: 120,
        },
      ],
    });
    const { container } = render(<PermitsListClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("BP-2026-0142");
    });
    expect(container.innerHTML).not.toContain("Not yet available");
    // Not "nothing to export" -- there is a row on screen -- and not a bare
    // "not built yet" either: it names the place that does export.
    expect(container.innerHTML).not.toContain("no rows to export");
    expect(container.innerHTML).toContain("Reports lists every report that can be exported");
  });
});
