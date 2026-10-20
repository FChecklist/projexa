/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { fingerprintOf, firstFrameFunction, normaliseMessage, routePattern } from "./fingerprint";

const stack = (fn: string, line: number) => `Error: boom\n    at ${fn} (https://px.test/_next/static/chunks/app.js:${line}:17)\n    at other (https://px.test/x.js:9:9)`;

describe("fingerprint", () => {
  test("the same problem gives the same fingerprint when only ids, numbers and line numbers differ", () => {
    const a = fingerprintOf({ kind: "api_failure", message: "GET /api/budgets/3f2a9c1e-1111-4222-8333-444455556666 failed (500): row 12 missing", route: "/budgets/41", stack: stack("loadBudget", 120) });
    const b = fingerprintOf({ kind: "api_failure", message: "GET /api/budgets/aaaaaaaa-1111-4222-8333-444455556666 failed (500): row 98 missing", route: "/budgets/77", stack: stack("loadBudget", 455) });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  test("a different kind, message, screen or first function gives a different fingerprint", () => {
    const base = { kind: "error", message: "x is undefined", route: "/budgets", stack: stack("fnA", 1) };
    const f = fingerprintOf(base);
    expect(fingerprintOf({ ...base, kind: "render_error" })).not.toBe(f);
    expect(fingerprintOf({ ...base, message: "y is undefined" })).not.toBe(f);
    expect(fingerprintOf({ ...base, route: "/scope" })).not.toBe(f);
    expect(fingerprintOf({ ...base, stack: stack("fnB", 1) })).not.toBe(f);
  });

  test("normalisers", () => {
    expect(normaliseMessage("Row 12 of 3,400 for 3f2a9c1e-1111-4222-8333-444455556666")).toBe("Row <n> of <n> for <id>");
    expect(routePattern("/projects/3f2a9c1e-1111-4222-8333-444455556666/budgets/12?x=1")).toBe("/projects/:id/budgets/:id");
    expect(firstFrameFunction("TypeError: x\n    at Object.save (https://a/b.js:1:2)")).toBe("save");
    expect(firstFrameFunction("save@https://a/b.js:1:2\nother@https://a/c.js:3:4")).toBe("save");
    expect(firstFrameFunction(null)).toBe("none");
  });
});
