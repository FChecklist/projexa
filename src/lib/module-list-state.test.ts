/// <reference types="bun-types" />
// R67 F-18 / F-20 -- the two decisions every module list client makes.
//
// These are the assertions that keep D-04's promise honest. If the first one
// breaks, a screen that was handed its rows by the server shows a spinner over
// them anyway, which is the entire latency win undone. If the second breaks, a
// project switch leaves an error card on the screen the user just arrived at,
// reporting a request THEY cancelled by navigating.

import { describe, expect, test } from "bun:test";
import { initialListState, isAbortError } from "./module-list-state";
import {
  BOQ_LIST_COLUMNS,
  DOCUMENTS_LIST_COLUMNS,
  DRAWINGS_LIST_COLUMNS,
  MANPOWER_LIST_COLUMNS,
  MATERIAL_LIST_COLUMNS,
  MOMS_LIST_COLUMNS,
  PERMITS_LIST_COLUMNS,
  SCHEDULE_TIMELINE_COLUMNS,
  WORK_PROGRESS_LIST_COLUMNS,
} from "./module-list-columns";

describe("initialListState", () => {
  test("server-fetched rows render immediately -- no spinner over data we already have", () => {
    const state = initialListState({ rows: [{ id: "p1" }, { id: "p2" }], errorMessage: null });
    expect(state.loading).toBe(false);
    expect(state.rows).toHaveLength(2);
    expect(state.error).toBeNull();
  });

  test("a server-side failure is shown, not retried behind a spinner", () => {
    const state = initialListState({ rows: [], errorMessage: "The construction data service did not respond in time." });
    expect(state.loading).toBe(false);
    expect(state.error).toBe("The construction data service did not respond in time.");
    // Empty rows AND an error: the screen must be able to tell "there are
    // none" from "we could not find out".
    expect(state.rows).toEqual([]);
  });

  test("an empty successful read is a real answer, not a loading state", () => {
    const state = initialListState({ rows: [], errorMessage: null });
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("no server payload means the client must fetch", () => {
    const state = initialListState(null);
    expect(state.loading).toBe(true);
    expect(state.rows).toEqual([]);
    expect(state.error).toBeNull();
  });
});

describe("isAbortError", () => {
  test("an aborted signal is a cancellation whatever the error says", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(new Error("Failed to fetch"), controller.signal)).toBe(true);
  });

  test("AbortError and TimeoutError are cancellations", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(timeout)).toBe(true);
  });

  test("a real backend failure is NOT swallowed as a cancellation", () => {
    const controller = new AbortController(); // never aborted
    const err = new Error("No VERIDIAN credentials configured (AR-04)");
    expect(isAbortError(err, controller.signal)).toBe(false);
    expect(isAbortError(err)).toBe(false);
  });
});

describe("the shared fallback columns", () => {
  // Every loading skeleton is built from these, so an empty or unlabelled
  // array would paint a headerless table that the real render then replaces.
  const ALL = {
    PERMITS_LIST_COLUMNS,
    MOMS_LIST_COLUMNS,
    DRAWINGS_LIST_COLUMNS,
    DOCUMENTS_LIST_COLUMNS,
    MANPOWER_LIST_COLUMNS,
    MATERIAL_LIST_COLUMNS,
    BOQ_LIST_COLUMNS,
    WORK_PROGRESS_LIST_COLUMNS,
    SCHEDULE_TIMELINE_COLUMNS,
  };

  test("every module has real, labelled, uniquely-keyed columns", () => {
    for (const [name, columns] of Object.entries(ALL)) {
      expect(columns.length, name).toBeGreaterThan(0);
      for (const col of columns) {
        expect(col.label.trim(), `${name}.${col.field}`).not.toBe("");
        expect(col.field.trim(), name).not.toBe("");
      }
      const fields = columns.map((c) => c.field);
      expect(new Set(fields).size, `${name} has duplicate fields`).toBe(fields.length);
    }
  });

  test("the labels are the ones the screens actually show", () => {
    // Spot-checked against the tables themselves; a silent relabel here would
    // make the skeleton and the loaded table disagree.
    expect(PERMITS_LIST_COLUMNS.map((c) => c.label)).toEqual([
      // R67 D-05 (lane D1, folded into this shared constant at the merge).
      // These four were "Permit no." / "Name" / "Authority" / "Expiry date"
      // here, while the permit CREATE form, the object page and the API all
      // said "Permit number", "Permit name", "Issuing authority" and "End
      // date". D-05 is that one field may not have two names inside one
      // module, and the worst of the four was "Expiry date" against the object
      // page's "End date" -- the same date, two screens, two words.
      //
      // Folding the word set into this constant rather than into
      // PermitsListClient is what also fixes the LOADING SKELETON: both read
      // this array, so the headers a user sees while waiting and the headers
      // they get cannot disagree.
      "Permit number",
      "Permit name",
      "Issuing authority",
      "Issue date",
      "End date",
      // R67 G-01 renamed this: the cell answers a question ("Expires in 12
      // days", "Expired") rather than promising a number, so the header asks
      // one. Asserted here because the skeleton and the loaded table both read
      // this constant, and a silent relabel would make them disagree.
      "Status",
    ]);
    expect(MOMS_LIST_COLUMNS.map((c) => c.label)).toEqual(["Meeting", "Date", "Status"]);
    expect(MANPOWER_LIST_COLUMNS.map((c) => c.label)).toEqual([
      "ID",
      "Name",
      "Trade",
      "Company",
      "Daily Rate",
      "Status",
    ]);
  });
});
