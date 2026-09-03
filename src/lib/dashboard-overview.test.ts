/// <reference types="bun-types" />
// R67 D-03 (R-002 / R-019): "No screen may render a failed GET as zero, 0 %
// or an empty list."
//
// The regression this file exists to catch is one character wide: putting `0`
// back where `null` now stands in fetchProjectProgressBars' inner catch. That
// single change turns "we could not read this project's progress" into "this
// project has made no progress", on the one screen an owner uses to judge a
// whole portfolio, with nothing on the page saying anything failed.
//
// callVeridian is module-mocked rather than hit for real: the point under
// test is the FAILURE MAPPING, and a test that needed a live VERIDIAN could
// not assert the failure branch at all.

import { describe, expect, test, mock, beforeEach } from "bun:test";

type Call = { path: string };
let calls: Call[] = [];
let behaviour: (path: string) => Promise<unknown> = async () => ({});

class FakeVeridianApiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    calls.push({ path });
    return behaviour(path);
  },
  VeridianApiError: FakeVeridianApiError,
}));

const { fetchProjectProgressBars } = await import("./dashboard-overview");

const ORG = {
  projects: [
    { id: "p-cedar", name: "Cedar Heights Villa" },
    { id: "p-marina", name: "Marina Tower" },
  ],
};

beforeEach(() => {
  calls = [];
});

describe("fetchProjectProgressBars", () => {
  // R67 F-01 (integration, lane F1). CORRECTED, NOT WEAKENED. This test used to
  // fail one of the PER-PROJECT calls -- GET /dashboard/{id}, one per project.
  // Those calls are gone: getOrgDashboard() now carries progressPercent for
  // every project in the org payload, so the N+1 that exhausted VERIDIAN's
  // five-connection pool is a single read. The property under test is
  // unchanged and is the whole point of the file: a project with NO readable
  // figure reports null, never 0, and its siblings are unaffected. What used
  // to arrive as a rejected sibling call now arrives as a row with no numeric
  // progressPercent -- the same fact, from the one call that replaced them.
  test("a project with no readable figure yields progressPercent null, and NEVER 0", async () => {
    behaviour = async (path) => {
      if (path === "/dashboard") {
        return {
          projects: [
            { id: "p-cedar", name: "Cedar Heights Villa" },
            { id: "p-marina", name: "Marina Tower", progressPercent: 62 },
          ],
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const { bars, errorMessage } = await fetchProjectProgressBars("org-1");

    expect(errorMessage).toBeNull();
    // The project is still LISTED -- its name came from the org call, which
    // succeeded. Only its number is missing.
    expect(bars.map((b) => b.id)).toEqual(["p-cedar", "p-marina"]);

    const cedar = bars.find((b) => b.id === "p-cedar")!;
    expect(cedar.progressPercent).toBeNull();
    expect(cedar.progressPercent).not.toBe(0);
    expect(cedar.name).toBe("Cedar Heights Villa");

    // The project whose call SUCCEEDED is unaffected by its neighbour's failure.
    expect(bars.find((b) => b.id === "p-marina")!.progressPercent).toBe(62);
  });

  test("a real zero survives -- 'no progress yet' is a figure and must still render as one", async () => {
    // R67 F-01: the figure now rides on the org payload's own project rows.
    behaviour = async (path) => {
      if (path === "/dashboard") {
        return { projects: ORG.projects.map((p) => ({ ...p, progressPercent: 0 })) };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const { bars } = await fetchProjectProgressBars("org-1");
    expect(bars.every((b) => b.progressPercent === 0)).toBe(true);
    expect(bars.every((b) => b.progressPercent !== null)).toBe(true);
  });

  test("a 200 whose body carries no numeric progressPercent is also 'no figure', not zero", async () => {
    behaviour = async (path) => {
      if (path === "/dashboard") return ORG;
      // The shapes a degraded upstream really returns: a missing field, and a
      // NaN that arrived as a non-numeric string somewhere upstream.
      if (path === "/dashboard/p-cedar") return { projectId: "p-cedar" };
      return { projectId: "p-marina", progressPercent: Number.NaN };
    };

    const { bars } = await fetchProjectProgressBars("org-1");
    expect(bars.map((b) => b.progressPercent)).toEqual([null, null]);
  });

  test("a failed ORG call still reports the error and shows no projects at all", async () => {
    behaviour = async () => {
      throw new FakeVeridianApiError("the construction data service did not respond", 504);
    };

    const { bars, errorMessage } = await fetchProjectProgressBars("org-1");
    expect(bars).toEqual([]);
    // The client renders this as the role=alert card with Retry, never as
    // "No active projects yet."
    expect(errorMessage).toBe("the construction data service did not respond");
  });

  test("a non-VeridianApiError failure still produces a message rather than an empty, silent list", async () => {
    behaviour = async () => {
      throw new TypeError("fetch failed");
    };

    const { bars, errorMessage } = await fetchProjectProgressBars(null);
    expect(bars).toEqual([]);
    expect(errorMessage).toBe("Failed to load project progress");
  });

  // R67 F-01 (integration, lane F1). CORRECTED, AND IT NOW ASSERTS THE ITEM.
  // This read was one call for the org PLUS one per project -- the N+1 of HTTP
  // requests, each opening its own transaction on a five-connection pool, that
  // this lane exists to remove. It is ONE call, and the assertion is now the
  // guarantee rather than a description of the fault: no matter how many
  // projects the org has, the portfolio screen costs a single upstream read.
  test("exactly ONE upstream call, however many projects the org has", async () => {
    behaviour = async (path) => {
      if (path === "/dashboard") {
        return {
          projects: [
            { id: "p-cedar", name: "Cedar Heights Villa", progressPercent: 40 },
            { id: "p-marina", name: "Marina Tower", progressPercent: 12 },
            { id: "p-harbour", name: "Harbour Yard", progressPercent: 7 },
          ],
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const { bars } = await fetchProjectProgressBars("org-1");

    expect(calls.map((c) => c.path)).toEqual(["/dashboard"]);
    expect(bars.map((b) => b.progressPercent)).toEqual([40, 12, 7]);
  });
});
