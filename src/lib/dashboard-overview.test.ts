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
  test("a rejected per-project call yields progressPercent null, and NEVER 0", async () => {
    behaviour = async (path) => {
      if (path === "/dashboard") return ORG;
      if (path === "/dashboard/p-cedar") throw new FakeVeridianApiError("upstream timeout", 504);
      return { projectId: "p-marina", progressPercent: 62 };
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
    behaviour = async (path) => {
      if (path === "/dashboard") return ORG;
      return { projectId: path.split("/").pop(), progressPercent: 0 };
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

  test("one call for the org and one per project -- a failure does not suppress its siblings", async () => {
    behaviour = async (path) => {
      if (path === "/dashboard") return ORG;
      if (path === "/dashboard/p-cedar") throw new FakeVeridianApiError("boom");
      return { projectId: "p-marina", progressPercent: 12 };
    };

    await fetchProjectProgressBars("org-1");
    expect(calls.map((c) => c.path)).toEqual(["/dashboard", "/dashboard/p-cedar", "/dashboard/p-marina"]);
  });
});
