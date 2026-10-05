import { describe, expect, test } from "bun:test";
import { summarise, verdict } from "../../scripts/verify/vercel-plan-check.mjs";

// AUDIT-100 A1: the logic of scripts/verify/vercel-plan-check.mjs (the read-only "is the Vercel team on Hobby with no paid add-on" check), on the
// shapes the Vercel API returns. The live run is recorded in ai-os/audit37/A1_VERCEL_PLAN_EVIDENCE_2026-10-05.md.

describe("Vercel plan check (A1)", () => {
  test("a Hobby team with no add-on passes", () => {
    const s = summarise(`Vercel CLI 54.14.2\n{"slug":"veridian-ai-os","billing":{"plan":"hobby","currency":"usd"}}`);
    expect(s).toMatchObject({ slug: "veridian-ai-os", plan: "hobby", addons: [] });
    expect(verdict(s)).toEqual([]);
  });

  test("CAN FAIL: a Pro team is reported", () => {
    const s = summarise(`{"slug":"x","billing":{"plan":"pro"}}`);
    expect(verdict(s)).toEqual(['plan is "pro", not "hobby"']);
  });

  test("CAN FAIL: a paid add-on on a Hobby team is reported", () => {
    const s = summarise(`{"slug":"x","billing":{"plan":"hobby","addons":{"speedInsightsPlus":{"on":true}}}}`);
    expect(verdict(s)).toEqual(["paid add-ons listed: speedInsightsPlus"]);
  });

  test("CAN FAIL: no billing information is not treated as Hobby", () => {
    expect(verdict(summarise(`{"slug":"x"}`)).length).toBe(1);
  });

  test("output with no JSON (not signed in) is an error, not a pass", () => {
    expect(() => summarise("Error: not logged in")).toThrow();
  });
});
