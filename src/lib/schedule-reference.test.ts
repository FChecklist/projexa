/// <reference types="bun-types" />
// R67 F-09 (R-122) -- sibling test for schedule-reference.ts.
//
// These two lookups moved from a post-hydration client fetch into the server
// component so a create screen's one un-typeable field (the select) is
// populated on the first rendered frame. The property that matters is the
// failure posture: a reference list is a CONVENIENCE, so a failed lookup must
// return an empty list and let the form render, never reject and take a
// working create screen down with it.
//
// @/lib/veridian-client is mocked at callVeridian: the real client resolves a
// per-org bearer token out of the database (AR-04), which is not what is under
// test here.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

class FakeVeridianApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let requestedPaths: string[] = [];
let requestedOptions: { timeoutMs?: number }[] = [];
let respond: (path: string) => Promise<unknown> = async () => ({});

mock.module("@/lib/veridian-client", () => ({
  VeridianApiError: FakeVeridianApiError,
  VERIDIAN_SCREEN_BUDGET_MS: 8_000,
  callVeridian: async (path: string, options: { timeoutMs?: number } = {}) => {
    requestedPaths.push(path);
    requestedOptions.push(options);
    return respond(path);
  },
}));

const { resolveIssueTypes, resolveScheduleTasks, resolveScheduleTaskLookup } = await import("./schedule-reference");

beforeEach(() => {
  requestedPaths = [];
  requestedOptions = [];
  respond = async () => ({});
});

afterEach(() => {
  respond = async () => ({});
});

describe("resolveIssueTypes", () => {
  test("returns the types and carries D-04's 8 s page budget", async () => {
    respond = async () => ({ types: [{ id: "t1", name: "Task", isDefault: true }] });

    expect(await resolveIssueTypes("org-1")).toEqual([{ id: "t1", name: "Task", isDefault: true }]);
    expect(requestedPaths).toEqual(["/schedule/types"]);
    expect(requestedOptions[0].timeoutMs).toBe(8_000);
  });

  test("a failure is an empty list, never a rejection -- the create screen still renders", async () => {
    respond = async () => {
      throw new FakeVeridianApiError("VERIDIAN did not respond in time", 504);
    };

    await expect(resolveIssueTypes("org-1")).resolves.toEqual([]);
  });

  test("a response with no types key is an empty list, not undefined", async () => {
    respond = async () => ({});
    expect(await resolveIssueTypes("org-1")).toEqual([]);
  });
});

describe("resolveScheduleTasks", () => {
  test("scopes the request to the project", async () => {
    respond = async () => ({ tasks: [{ id: "i1", number: 3, title: "Pour slab" }] });

    expect(await resolveScheduleTasks("p1", "org-1")).toHaveLength(1);
    expect(requestedPaths[0]).toBe("/schedule?projectId=p1");
  });

  test("a project id with URL-significant characters is encoded, not interpolated raw", async () => {
    respond = async () => ({ tasks: [] });

    await resolveScheduleTasks("p 1&x=2", "org-1");
    expect(requestedPaths[0]).toBe("/schedule?projectId=p%201%26x%3D2");
  });

  test("a failure is an empty list, never a rejection", async () => {
    respond = async () => {
      throw new FakeVeridianApiError("upstream down", 502);
    };

    await expect(resolveScheduleTasks("p1", "org-1")).resolves.toEqual([]);
  });
});

// R67 F-11 (R-146): "the lookup failed" and "this project has no tasks" are
// different facts, and Log Time says different things about them -- so the
// resolver has to be able to tell them apart. It still never throws.
describe("resolveScheduleTaskLookup", () => {
  test("a successful empty response is NOT reported as unavailable", async () => {
    respond = async () => ({ tasks: [] });

    expect(await resolveScheduleTaskLookup("p1", "org-1")).toEqual({ tasks: [], unavailable: false });
  });

  test("a failure is reported as unavailable, with an empty list and no rejection", async () => {
    respond = async () => {
      throw new FakeVeridianApiError("upstream down", 502);
    };

    expect(await resolveScheduleTaskLookup("p1", "org-1")).toEqual({ tasks: [], unavailable: true });
  });

  test("a successful response carries its tasks through unchanged", async () => {
    respond = async () => ({ tasks: [{ id: "i1", number: 3, title: "Pour slab" }] });

    expect(await resolveScheduleTaskLookup("p1", "org-1")).toEqual({
      tasks: [{ id: "i1", number: 3, title: "Pour slab" }],
      unavailable: false,
    });
  });
});
