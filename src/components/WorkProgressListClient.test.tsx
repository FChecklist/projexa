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
};

const LOOKUPS = {
  activityNameById: new Map([["act-1", "Blockwork"]]),
  boqLineDescriptionById: new Map([["li-1", "A.1 -- Walls"]]),
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
    expect(container.textContent).toContain("A.1 -- Walls");
    expect(container.textContent).toContain("1 record");
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
