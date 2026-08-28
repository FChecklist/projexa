/// <reference types="bun-types" />
// R62 B7 regression test for F_014 ("both 'Compare' and 'New Revision' on a
// BOQ row are wired to the same broken self-compare handler; New Revision
// never calls any create endpoint").
//
// RE-VERIFIED LIVE ON CURRENT MAIN BEFORE WRITING THIS FILE, per this task's
// own instruction to check first: F_014's row already carries three
// independent re-investigations (R52, R52 fn-agent, R57) all reaching the
// same conclusion, and reading ScopeClient.tsx directly confirms it again --
// this fault is NOT REPRODUCIBLE against the current file:
//   - Compare and New Revision call two distinct functions, not one shared
//     handler: openCompareDialog(b) and openRevisionDialog(b)
//     (ScopeClient.tsx ~L650-651).
//   - They open two different dialogs with correctly interpolated titles
//     ("Compare -- "{title}" (v{version})" vs "New Revision -- from
//     "{title}" (v{version})"), not one shared dialog with a malformed
//     "(v)" title.
//   - openCompareDialog defaults `against` to findOriginalBoqId(boq), which
//     walks parentBoqId to null -- the ORIGINAL, not the row's own id. A
//     baseline BOQ (no parent) has itself as its own original, so IT alone
//     legitimately compares against itself; that is a documented owner
//     ruling in the code's own comment (L529-537: "compared to original
//     scope, Rev 1, Rev 2 ... a variation claim is made against the
//     contract"), not the hardcoded self-reference bug the row describes.
//     A REVISION (has a parent) must default to comparing against the
//     original, never against its own id -- that is the one part of the
//     original report this suite pins down as a live behavioural guard.
//   - submitRevision genuinely POSTs to /api/scope/{id}/revisions -- New
//     Revision does call a real create endpoint.
//
// So: no code fix is being introduced by this file (matches wf_fix=false on
// the row). This suite exists to guard that CONFIRMED-NOT-REPRODUCIBLE
// finding against silently regressing back into the originally reported
// shape -- i.e. it is the "real test" this closed fault was missing, not
// evidence of a change.
//
// SEPARATE FILE, not an addition to the ScopeClient.test.tsx already present
// in this working tree: that file covers a different fault
// (R46M13_TC10_01, the createBoq false-success bug) and was mid-edit by
// another lane when this was written -- left untouched per this task's own
// "never weaken/rewrite an existing test" rule.
//
// HARNESS NOTE: fireEvent.change does not deliver a synthetic onChange for a
// controlled <input> in this repo's bun:test + happy-dom + React 19 setup
// (verified independently, see PermitCreateClient.test.tsx's docstring) --
// so these tests never type into a field. They don't need to: Compare needs
// no dialog input at all (it fires its GET on open), and New Revision's line
// items come from the mocked GET /api/scope/{id} response that
// openRevisionDialog loads on open, not from anything the test would
// otherwise have to type in.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const ScopeClient = (await import("./ScopeClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BASELINE = { id: "boq-base", version: 1, title: "Civil Works", status: "approved", parentBoqId: null, createdAt: "2026-01-01T00:00:00Z" };
const REVISION = { id: "boq-rev1", version: 2, title: "Civil Works", status: "draft", parentBoqId: "boq-base", createdAt: "2026-02-01T00:00:00Z" };

function makeFetch(calls: { method: string; url: string }[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });

    if (url === "/api/currencies") return jsonRes({ currencies: [] });
    if (url === "/api/scope?projectId=proj-1") return jsonRes({ boqs: [BASELINE, REVISION] });
    // load()'s own per-revision variation fetch -- no query string.
    if (url === "/api/scope/boq-rev1/compare") return jsonRes({ added: [], removed: [], changed: [], warnings: [], totalVariation: 250 });
    // openCompareDialog's fetch, WITH a query string -- what this suite
    // actually asserts on.
    if (url.startsWith("/api/scope/boq-rev1/compare?")) return jsonRes({ added: [], removed: [], changed: [], warnings: [], totalVariation: 0 });
    // openRevisionDialog loading the current line items to revise.
    if (url === "/api/scope/boq-rev1") {
      return jsonRes({
        lineItems: [
          { id: "li-1", itemCode: "A", description: "Excavation", unit: "m3", quantity: "10", rate: "100", amount: "1000", activityId: null },
        ],
      });
    }
    if (url === "/api/scope/boq-rev1/revisions" && method === "POST") return jsonRes({ id: "boq-rev2" }, 201);

    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  }) as typeof fetch;
}

describe("ScopeClient Compare / New Revision (F_014, CONFIRMED NOT REPRODUCIBLE -- guarding it stays that way)", () => {
  test("Compare and New Revision are wired to genuinely different actions, not one shared handler", async () => {
    const calls: { method: string; url: string }[] = [];
    globalThis.fetch = makeFetch(calls);

    const { getByRole, getAllByRole } = render(<ScopeClient projectId="proj-1" />);
    await waitFor(() => expect(getAllByRole("row").length).toBeGreaterThan(1));

    const revisionRow = getAllByRole("row").find((r) => within(r).queryByText("v2"));
    expect(revisionRow).toBeDefined();

    fireEvent.click(within(revisionRow!).getByRole("button", { name: /Compare/i }));
    await waitFor(() => expect(getByRole("heading", { name: /^Compare/ })).toBeDefined());
    // The original bug's own signature: a malformed title missing its
    // interpolated version numbers.
    expect(getByRole("heading", { name: /^Compare/ }).textContent).not.toBe("Compare -- (v)");
    expect(getByRole("heading", { name: /^Compare/ }).textContent).toContain("v2");

    fireEvent.click(getByRole("button", { name: /Close|×/i, hidden: true }) ?? document.body);
  });

  test("Compare on a revision defaults `against` to the ORIGINAL BOQ, never to the revision's own id (the reported self-compare)", async () => {
    const calls: { method: string; url: string }[] = [];
    globalThis.fetch = makeFetch(calls);

    const { getAllByRole } = render(<ScopeClient projectId="proj-1" />);
    await waitFor(() => expect(getAllByRole("row").length).toBeGreaterThan(1));
    const revisionRow = getAllByRole("row").find((r) => within(r).queryByText("v2"))!;

    fireEvent.click(within(revisionRow).getByRole("button", { name: /Compare/i }));

    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/scope/boq-rev1/compare?against="))).toBe(true));
    const compareCall = calls.find((c) => c.url.startsWith("/api/scope/boq-rev1/compare?against="))!;
    // The regression this pins down: `against` must be the walked-original
    // (boq-base), never boq-rev1 itself.
    expect(compareCall.url).toBe("/api/scope/boq-rev1/compare?against=boq-base");
    expect(compareCall.url).not.toContain("against=boq-rev1");
  });

  test("New Revision opens a distinct dialog from Compare and its Create button genuinely POSTs to /api/scope/{id}/revisions", async () => {
    const calls: { method: string; url: string }[] = [];
    globalThis.fetch = makeFetch(calls);

    const { getByRole, getAllByRole } = render(<ScopeClient projectId="proj-1" />);
    await waitFor(() => expect(getAllByRole("row").length).toBeGreaterThan(1));
    const revisionRow = getAllByRole("row").find((r) => within(r).queryByText("v2"))!;

    fireEvent.click(within(revisionRow).getByRole("button", { name: /New Revision/i }));

    await waitFor(() => expect(getByRole("heading", { name: /^New Revision/ })).toBeDefined());
    // Not the Compare dialog -- distinct titles, distinct dialogs.
    expect(getByRole("heading", { name: /^New Revision/ }).textContent).toContain("Civil Works");
    expect(getByRole("heading", { name: /^New Revision/ }).textContent).toContain("v2");

    // openRevisionDialog's own load -- proves it reads the CURRENT scope,
    // not a self-compare.
    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.url === "/api/scope/boq-rev1")).toBe(true));

    fireEvent.click(getByRole("button", { name: /Create Revision/i }));

    // The regression F_014 reported: New Revision never called any
    // create/POST endpoint at all.
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/scope/boq-rev1/revisions")).toBe(true));
  });
});
