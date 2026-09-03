/// <reference types="bun-types" />
// R67 D-55 / D-65 -- the Daily Entry list, asserted against the rule its
// parent used to break.
//
// The old contract was `loading: boolean` plus an entries array, and
// WorkProgressPageClient handed it `entriesRes.entries ?? []` from a body
// whose status was never read. A 500 therefore arrived here as
// `loading=false, entries=[]`, indistinguishable from a project that had
// logged nothing -- and the kit's ListScreen printed "No progress entries
// logged yet." on its own behalf. These tests pin the replacement: the pane
// takes the read's STATE, the empty sentence needs "ready", and the kit is
// never handed an empty row set at all.
//
// R67 MERGE (lane F2's F-24, audit R-240). The BOQ-line label is no longer
// resolved from a client-side lookup map: VERIDIAN LEFT JOINs both names into
// the progress query and sends boqItemCode / boqDescription with each entry
// (compliance-tracker #1579), which is what deleted the /api/scope +
// /api/scope/{id} pair this screen used to make to fill one column. The
// fixture below therefore carries the names ON the row, and the assertions
// keep exactly the properties they were written for. activityNameById stays as
// the FALLBACK it now is, for a row whose activityName did not come back.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/work-progress",
}));

const WorkProgressListClient = (await import("./WorkProgressListClient")).default;

afterEach(cleanup);

const ENTRY = {
  id: "e-1",
  activityId: "act-1",
  boqLineItemId: "li-1",
  entryDate: "2026-08-28",
  quantityDone: "12",
  percentComplete: "40",
  entryBasis: "quantity",
  remarks: null,
  // F-24: resolved server-side and sent with the row.
  activityName: "Blockwork",
  boqItemCode: "A.1",
  boqDescription: "Walls",
};

const LOOKUPS = {
  activityNameById: new Map([["act-1", "Blockwork"]]),
};

describe("WorkProgressListClient", () => {
  test("a failed read says so, offers Retry, and never claims the log is empty", () => {
    const { container } = render(
      <WorkProgressListClient
        entries={[]}
        {...LOOKUPS}
        status="error"
        error={{ status: 500, message: "The construction data service did not respond." }}
        onRetry={() => {}}
        projectId="p-cedar"
        projectName="Cedar Heights Villa - Phase 1"
      />
    );

    expect(container.textContent).toContain("Couldn't load progress entries");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("No progress entries logged yet.");
    // ...and the count beside it is an en-dash, not "0 records".
    expect(container.textContent).not.toContain("0 records");
    expect(container.textContent).toContain("—");
  });

  test("only a successful, genuinely empty read reaches the empty sentence", () => {
    const { container } = render(
      <WorkProgressListClient
        entries={[]}
        {...LOOKUPS}
        status="ready"
        projectId="p-cedar"
        projectName="Cedar Heights Villa - Phase 1"
      />
    );

    expect(container.textContent).toContain("No progress entries logged yet.");
    expect(container.textContent).toContain("0 records");
    expect(container.textContent).not.toContain("Couldn't load progress entries");
  });

  test("rows render, resolved through the lookups, with a real count", () => {
    const { container } = render(
      <WorkProgressListClient
        entries={[ENTRY]}
        {...LOOKUPS}
        status="ready"
        projectId="p-cedar"
        projectName="Cedar Heights Villa - Phase 1"
      />
    );

    expect(container.textContent).toContain("Blockwork");
    // F-24's join, rendered: "<code> — <description>", never the raw id.
    expect(container.textContent).toContain("A.1 — Walls");
    expect(container.textContent).not.toContain("li-1");
    expect(container.textContent).toContain("1 record");
  });

  test("a row whose BOQ line was deleted shows an em-dash, never the raw id (F-24)", () => {
    const { container } = render(
      <WorkProgressListClient
        entries={[{ ...ENTRY, boqItemCode: null, boqDescription: null }]}
        {...LOOKUPS}
        status="ready"
        projectId="p-cedar"
        projectName="Cedar Heights Villa - Phase 1"
      />
    );

    expect(container.textContent).not.toContain("li-1");
  });

  test("an entry whose activityName did not come back falls back to the lookup", () => {
    const { container } = render(
      <WorkProgressListClient
        entries={[{ ...ENTRY, activityName: null }]}
        {...LOOKUPS}
        status="ready"
        projectId="p-cedar"
        projectName="Cedar Heights Villa - Phase 1"
      />
    );

    expect(container.textContent).toContain("Blockwork");
  });

  test("rows already on screen survive a failed refresh, dated rather than blanked", () => {
    const { container } = render(
      <WorkProgressListClient
        entries={[ENTRY]}
        {...LOOKUPS}
        status="error"
        error={{ status: 504, message: null }}
        onRetry={() => {}}
        loadedAt={new Date("2026-08-28T10:32:00.000Z")}
        projectId="p-cedar"
        projectName="Cedar Heights Villa - Phase 1"
      />
    );

    expect(container.textContent).toContain("Blockwork");
    expect(container.textContent).toContain("as of 14:32");
    expect(container.textContent).toContain("Couldn't load progress entries");
  });
});
