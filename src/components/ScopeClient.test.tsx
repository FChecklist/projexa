/// <reference types="bun-types" />
// R62 B7 regression test for R46M13_TC10_01 (Critical).
//
// THE DEFECT (R43/M13 TC-10, reproduced 3x live 2026-08-25): creating a BOQ
// through the real "New BOQ" dialog showed a false-positive success -- a
// green "BOQ created" toast, dialog closed cleanly -- while nothing was
// actually persisted (server-verified: zero rows in
// compliance.construction_boqs for any of the three attempts). Two distinct
// swallow points made a non-write indistinguishable from a write:
//   (1) `res.json().catch(() => ({}))` turned an unparseable 2xx body into
//       an empty object that still sailed through to the success toast.
//   (2) success was declared from res.ok ALONE -- nothing ever checked that
//       a real BOQ id, or the submitted line item count, actually came back.
//
// THE FIX (projexa#157 / c8075b6): an unparseable body is now itself a
// failed create; a missing `id` throws "the server did not confirm a saved
// BOQ"; a returned lineItems count short of what was submitted throws
// naming both numbers. NOTE (per the fault's own justification, left
// unclosed by the R52 agent who fixed this): this closes the LIE, not the
// WRITE -- the underlying VERIDIAN persistence gap is a separate backend
// fix (compliance-tracker#1390). This test only re-guards the client-side
// contract PROJEXA itself owns: a create must never claim success without
// proof, whatever the server actually did.
//
// TESTED VIA THE EXTRACTED PURE FUNCTION, NOT THE RENDERED FORM: this
// repo's test environment (happy-dom + React 19 + bun:test, no
// @testing-library/user-event installed) does not reliably deliver a
// fireEvent-driven text-input change to a controlled React input -- verified
// directly (a minimal controlled <input>'s onChange never fired for either
// fireEvent.change or fireEvent.input in this stack). Driving the real
// "New BOQ" dialog's Title/line-item fields would silently test nothing.
// confirmBoqCreated() (ScopeClient.tsx) was pulled out specifically so this
// exact contract -- what response createBoq() will and will not accept as a
// genuine save -- can be verified without going through form-fill.
import { describe, expect, test } from "bun:test";
import { confirmBoqCreated } from "./ScopeClient";

describe("confirmBoqCreated (R46M13_TC10_01)", () => {
  test("a non-ok response throws the backend's own error message", () => {
    expect(() => confirmBoqCreated(false, { error: "VERIDIAN scope service unavailable" }, false, 1))
      .toThrow("VERIDIAN scope service unavailable");
  });

  test("a non-ok response with no usable error body falls back to a generic message", () => {
    expect(() => confirmBoqCreated(false, null, false, 1)).toThrow("Couldn't create BOQ");
  });

  test("a 2xx response whose body would not parse is a FAILED create, never a silent pass-through", () => {
    // The exact first swallow point: `res.json().catch(() => ({}))` used to
    // turn this into an empty object that sailed through to success.
    expect(() => confirmBoqCreated(true, null, /* parseFailed */ true, 1))
      .toThrow("Couldn't create BOQ — the server's response was unreadable, so nothing is confirmed saved.");
  });

  test("a 2xx response with no confirmed BOQ id is a FAILED create -- this IS the reproduced TC-10 false-positive", () => {
    // res.ok true, body parses fine, but nothing proves a row was written --
    // exactly what the live reproduction showed three separate times.
    expect(() => confirmBoqCreated(true, { lineItems: [] }, false, 1))
      .toThrow("Couldn't create BOQ — the server did not confirm a saved BOQ. Nothing was saved.");
  });

  test("an id present but blank/whitespace-only is treated the same as no id", () => {
    expect(() => confirmBoqCreated(true, { id: "   ", lineItems: [] }, false, 1))
      .toThrow("Couldn't create BOQ — the server did not confirm a saved BOQ. Nothing was saved.");
  });

  test("a saved id with FEWER line items echoed back than submitted is a FAILED create -- the weighted-children shape that actually regressed (parent + 3 weighted children = 4 submitted)", () => {
    expect(() => confirmBoqCreated(true, { id: "boq-1", lineItems: [{ id: "li-1" }] }, false, 4))
      .toThrow("Couldn't create BOQ — 4 line item(s) were submitted but only 1 came back saved.");
  });

  test("a genuine successful create (id + full line item count echoed back) returns the id and does not throw", () => {
    const id = confirmBoqCreated(
      true,
      { id: "boq-1", lineItems: [{ id: "li-1" }, { id: "li-2" }, { id: "li-3" }, { id: "li-4" }] },
      false,
      4
    );
    expect(id).toBe("boq-1");
  });

  test("MORE line items echoed back than submitted is still accepted (only a shortfall is suspicious)", () => {
    expect(confirmBoqCreated(true, { id: "boq-1", lineItems: [{}, {}] }, false, 1)).toBe("boq-1");
  });
});
