/// <reference types="bun-types" />
// GROUP G2: every fault the work-progress, change-order, billing, invoice and site-instruction screens can raise themselves has its own complete guide,
// whose "Fix it now" goes to a real screen and (on the same screen) names the box to outline.
import { describe, expect, test } from "bun:test";
import { G2_FAULT_CODES, G2_FAULT_FIELDS, type Fault } from "../g2-faults";
import { faultContext } from "../g2-faults";
import { matchGuide, resolveGuide } from "../match";
import { ALL_GUIDES } from "./all";

const ctx = (code: string) => {
  const fault: Fault = { code, field: G2_FAULT_FIELDS[code] || "x", message: "A sentence about the problem." };
  return { ...faultContext(fault), route: "/work-progress", search: "?projectId=p1", projectId: "p1", entityId: "e1" };
};

describe("G2 fault codes each have their own guide", () => {
  for (const code of G2_FAULT_CODES) {
    test(code, () => {
      const c = ctx(code);
      const g = matchGuide(c, ALL_GUIDES);
      expect(g.match.code, `${code} fell to ${g.id}`).toBe(code);
      const r = resolveGuide(g, c);
      expect(r.title.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(r.steps.length).toBeGreaterThanOrEqual(1);
      expect(r.steps.length).toBeLessThanOrEqual(4);
      expect(r.what.length).toBeGreaterThan(10);
      expect(r.fix, `${code} has no fix button`).not.toBeNull();
      expect(r.fix!.href.startsWith("/")).toBe(true);
    });
  }
});

describe("G2 server refusals", () => {
  const cases: [string, number, string, string][] = [
    ["wp-line-gone", 404, "BOQ line item not found", "/api/work-progress"],
    ["billing-no-new-progress", 400, "No new progress to bill -- every tracked line item is already billed up to its current percent complete", "/api/billing-claims/c1"],
    ["billing-status-conflict", 409, "Cannot move a 'drafted' claim to 'drafted' -- valid next status(es): submitted", "/api/billing-claims/c1"],
    ["co-permission", 403, "Forbidden: your role does not permit this action", "/api/change-orders"],
    ["si-not-found", 404, "Site instruction not found", "/api/site-instructions/x"],
    ["si-permission", 403, "Forbidden: your role does not permit this action", "/api/site-instructions"],
    ["progress-over-100-quantity", 422, "Progress on 1.01 would reach 12 of 10 m2 (120%), more than 100%. Only 4 m2 remains on this line.", "/api/work-progress"],
  ];
  for (const [id, status, serverMessage, apiPath] of cases) {
    test(id, () => {
      const c = { route: "/x", search: "", status, serverMessage, apiPath, method: id === "si-not-found" ? "GET" : "POST" };
      expect(matchGuide(c, ALL_GUIDES).id).toBe(id);
    });
  }
  test("timeout of the Invoice call has its own guide, an unconfirmed one too", () => {
    expect(matchGuide({ route: "/x", search: "", status: 0, code: "TIMEOUT", method: "PATCH", apiPath: "/api/billing-claims/c1" }, ALL_GUIDES).id).toBe("billing-invoice-maybe-raised");
    expect(matchGuide({ route: "/x", search: "", status: 200, code: "UNCONFIRMED", method: "PATCH", apiPath: "/api/billing-claims/c1" }, ALL_GUIDES).id).toBe("billing-invoice-unconfirmed");
  });
  test("over-100 guides outline the quantity / percent box", () => {
    const q = ALL_GUIDES.find((g) => g.id === "progress-over-100-quantity")!;
    const p = ALL_GUIDES.find((g) => g.id === "progress-over-100-percent")!;
    expect(q.fix?.focus).toBe("wp-quantity");
    expect(p.fix?.focus).toBe("wp-percent");
  });
});
