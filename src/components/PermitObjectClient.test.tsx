/// <reference types="bun-types" />
// R62 B7 regression test for F_011 ("all three action controls on the permit
// detail page are dead no-ops -- Edit, Back, and 'More details' collapse").
//
// THE ROW'S OWN RECORDED DIAGNOSIS, WHICH DID NOT SURVIVE READING THE CODE:
// F_011 was filed as a kit-level ObjectScreen/FormSection click-handler
// wiring bug (grouped with the same Radix-hydration family as F_009/F_016/
// F_019). Reading the kit source directly disproves this: ObjectScreen
// attaches plain React onClick props to Edit and Back
// (@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:107-108,
// :136-137), and PermitObjectClient.tsx wires real functions into both
// (onEdit :182, onBack :192 below) -- there is no kit-level handler-
// attachment defect to fix.
//
// WHAT WAS ACTUALLY WRONG, and IS fixed here (the fault row's own recorded
// closing evidence -- PR #165, ebbd0dd, fix_files
// src/components/PermitObjectClient.tsx): load() never read res.ok. GET
// /api/permits/[id] answers a failure with { error: "..." }, and that body
// was stored AS the permit. It is truthy, so the old `!permit` guard let it
// through, and the page rendered a permit-SHAPED screen built out of an
// error: titled "New Permit" (permit.name undefined), subtitle undefined,
// and -- this is the part that reads exactly like F_011's own report --
// onBack pointing at /permits?projectId=undefined instead of a real project.
// A screen built from wreckage isn't "Back is a dead no-op"; it's "Back goes
// somewhere wrong because what it read its target from was never a real
// permit in the first place". Same defect class as A4S14_04/A4S14_05.
//
// THE FIX: fetchJson (src/lib/fetch-json.ts) is used instead of a bare
// fetch().then(r => r.json()), so a non-2xx response throws instead of
// masquerading as data; load() catches that into a real loadError state
// (role="alert", with a Retry button) instead of ever setting `permit` to
// something error-shaped.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own comment on
// this. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

const PermitObjectClient = (await import("./PermitObjectClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("PermitObjectClient (F_011: a failed GET must never render as a fake permit)", () => {
  test("a 500 from GET /api/permits/{id} shows the backend's real error, not a permit-shaped screen built from the error body", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonRes({ error: "Permit not found or access denied" }, 500);
    }) as typeof fetch;

    const { getByRole, queryByText } = render(<PermitObjectClient permitId="permit-404" />);

    // The regression, precisely: this used to render permit.name || "New
    // Permit" for an object that was actually { error: "..." } -- i.e. this
    // exact title, for a permit that was never loaded.
    await waitFor(() => expect(getByRole("alert").textContent).toMatch(/Permit not found or access denied/));
    expect(queryByText("New Permit")).toBeNull();
    expect(calls).toBe(1);
  });

  test("Retry re-issues the same GET rather than being another dead control on the broken screen", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonRes({ error: "Permit not found or access denied" }, 500);
    }) as typeof fetch;

    const { getByRole } = render(<PermitObjectClient permitId="permit-404" />);
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    expect(calls).toBe(1);

    fireEvent.click(getByRole("button", { name: /Retry/i }));
    await waitFor(() => expect(calls).toBe(2));
  });

  test("a genuinely successful load renders the real permit, not an error state", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/permits/")) {
        return jsonRes({
          id: "permit-9", name: "Fire Safety Permit", permitNumber: "FS-001", permitAuthority: "City",
          issueDate: "2026-01-01", endDate: "2027-01-01", notes: null, tags: [], projectId: "proj-1", documentUrl: null,
        });
      }
      if (url.includes("/api/screen-drafts")) return jsonRes({});
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { getAllByText, queryByRole } = render(<PermitObjectClient permitId="permit-9" />);

    // Renders in more than one place (breadcrumb/title + the read-only field
    // itself) -- any real occurrence is enough to prove this is a genuine
    // permit render, not the error path.
    await waitFor(() => expect(getAllByText("Fire Safety Permit").length).toBeGreaterThan(0));
    expect(queryByRole("alert")).toBeNull();
  });
});
