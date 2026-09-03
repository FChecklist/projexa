/// <reference types="bun-types" />
// R67 F-06 (R-088/R-094) acceptance test -- the runnable half.
//
// THE FAULT THIS GUARDS. /labour used to fetch the project's ENTIRE attendance
// history -- workers x days, unbounded -- on every page load, in the same
// Promise.allSettled that gated the roster table the user actually came for.
//
// ─── WHY THIS IS A SEPARATE FILE ────────────────────────────────────────────
//
// Lane F1 and lane D-65 both added tests at LabourClient.test.tsx (an add/add).
// D-65's are about PaneState -- a failed read never printing an empty sentence
// -- and are kept verbatim in that file. These two are about the request
// pattern, so they are kept here rather than dropped.
//
// ─── WHAT THE MERGE CHANGED, AND WHERE THE REST OF F1's COVERAGE WENT ───────
//
// Lanes F1 and D-31/F-25 solved this defect independently and the merged screen
// is D-31/F-25's, so three of F1's five assertions named a mechanism that no
// longer exists (a fixed 30-day `from=`/`to=` window widening to 60, a control
// labelled "Load older", and a warm-on-hover prefetch). Nothing they guarded
// was dropped -- the merged screen asks a NARROWER question, and the contract
// is asserted deterministically one layer down, in src/lib/attendance-query.test.ts:
//
//   * "one day is an equality" -- the default read is `date=`, not a range;
//   * "'Show earlier days' is an inclusive window ENDING on the chosen day";
//   * "the window is EARLIER_DAYS long ..., never one more" -- still bounded,
//     which is the property F1's 30-day assertion existed to protect.
//
// Those three are NOT re-asserted here, because they cannot be: driving Radix's
// TabsTrigger in this harness (bun + happy-dom + React 19) throws React's
// "Should not already be working" before any assertion runs -- measured, not
// assumed, and consistent with the environment limits this programme has
// already recorded (React receives no input/change events here; Radix Select
// selection does not commit). A tab-activation walk is therefore owed to the
// Phase 3 browser pass, and is listed there rather than faked with a test that
// passes without exercising anything.
//
// The two below need no tab interaction and are genuinely new coverage: main
// asserts neither.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/labour",
  useSearchParams: () => new URLSearchParams(),
}));

const LabourClient = (await import("./LabourClient")).default;
const { EMPTY_VALUE } = await import("@/lib/format-money");

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

// bun test runs every file in ONE process, so under a full-suite run these
// renders share a machine with every other suite. @testing-library's default
// 1 s waitFor budget then measures the machine, not the component. The
// assertions themselves are unchanged.
const WAIT = { timeout: 8_000 } as const;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// vendorId names a vendor the shell bootstrap does not carry, which is the
// state the Company column has to degrade for.
const ROSTER = [
  { id: "r1", name: "Ravi Kumar", employeeCode: "EMP-001", trade: "Mason", skillLevel: null, vendorId: "v1", dailyRate: "180", isActive: true },
];

function stubFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/labour-roster")) return jsonRes({ roster: ROSTER });
    if (url.includes("/api/attendance")) return jsonRes({ attendance: [] });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

describe("LabourClient — the attendance log is deferred, and the roster does not wait on it", () => {
  test("no /api/attendance request is made while the Roster tab is the active one", async () => {
    // F-06's central claim, and the one regression that would silently undo the
    // whole item: landing on /labour must cost the roster read and nothing else.
    const calls = stubFetch();

    const { getByText } = render(<LabourClient projectId="p1" />);

    await waitFor(() => expect(getByText("Ravi Kumar")).toBeDefined(), WAIT);

    expect(calls.filter((u) => u.includes("/api/attendance"))).toHaveLength(0);
    // The roster call itself is the one the screen exists for.
    expect(calls.filter((u) => u.includes("/api/labour-roster"))).toHaveLength(1);
  });

  test("a vendor the shell could not resolve degrades the Company cell to the empty marker, and never blocks the roster", async () => {
    // CORRECTED FROM F1's VERSION: F1 failed a /api/vendors call. The merged
    // screen takes vendors from the shell bootstrap instead of fetching them
    // per screen -- which is F1's own stated goal, reached by the other lane --
    // so the unresolvable case is now a vendorId with no matching vendor. The
    // property asserted is unchanged: the roster still renders, and the cell
    // shows R67 G-04's ONE empty marker rather than a raw id or a local em-dash.
    stubFetch();

    const { getByText, getAllByText } = render(<LabourClient projectId="p1" />);

    await waitFor(() => expect(getByText("Ravi Kumar")).toBeDefined(), WAIT);
    expect(getAllByText(EMPTY_VALUE).length).toBeGreaterThan(0);
  });
});
