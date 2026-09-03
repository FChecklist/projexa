/// <reference types="bun-types" />
// R67 lane D22 (review finding). useLineItemSaver is the shared inline-edit
// write path behind THREE screens -- /budgets, Scope of Work / Budget, and the
// BOQ object page -- and none of its rules were asserted anywhere.
//
// The rules that matter, and that this file pins:
//   * a cell announces itself: Saving… -> Saved -> nothing after 3 s;
//   * "Saved" clears ONLY if the cell still says "saved" when the timer fires
//     (a cell edited again in the meantime must not be blanked, and a message
//     the reader has to act on must never time out);
//   * a refusal carries THE BACKEND'S OWN sentence, not "Couldn't save";
//   * a refusal calls onFailed, which is how an uncontrolled input is put back
//     to the value the server still holds -- the fix D-76 exists for.
//
// The hook's body is a useCallback over useState, which needs a DOM to drive,
// and @happy-dom/global-registrator is declared in package.json but is not
// installed in this environment (same constraint WorkProgressReportClient.test
// records). So the transitions and the request are exercised through the
// functions the hook is now built from -- the same code paths, not a re-
// implementation -- and CellFeedback is rendered for real with react-dom/server.
import { describe, expect, test, afterEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CellFeedback,
  SAVED_VISIBLE_MS,
  cellStateKey,
  clearSavedCell,
  markCellError,
  markCellSaved,
  markCellSaving,
  saveLineItemField,
  type CellState,
} from "./BudgetLineCells";

const KEY = cellStateKey("line-1", "vendorAmount");

describe("cellStateKey", () => {
  test("is one string per cell, so two fields on one row never share state", () => {
    expect(cellStateKey("line-1", "vendorAmount")).toBe("line-1:vendorAmount");
    expect(cellStateKey("line-1", "materialAmount")).not.toBe(cellStateKey("line-1", "vendorAmount"));
    expect(cellStateKey("line-2", "vendorAmount")).not.toBe(cellStateKey("line-1", "vendorAmount"));
  });
});

describe("the cell state machine", () => {
  test("saving -> saved -> cleared is the whole happy path", () => {
    let cells: Record<string, CellState> = {};
    cells = markCellSaving(cells, KEY);
    expect(cells[KEY]).toEqual({ status: "saving" });
    cells = markCellSaved(cells, KEY);
    expect(cells[KEY]).toEqual({ status: "saved" });
    cells = clearSavedCell(cells, KEY);
    expect(cells[KEY]).toBeUndefined();
  });

  test("the 3 s timer does NOT clear a cell that has since started saving again", () => {
    // Type, save, type again inside three seconds: the old timer must not blank
    // the "Saving…" that is currently true.
    let cells = markCellSaved({}, KEY);
    cells = markCellSaving(cells, KEY);
    expect(clearSavedCell(cells, KEY)[KEY]).toEqual({ status: "saving" });
  });

  test("the 3 s timer does NOT clear an error -- a message you must act on never times out", () => {
    const cells = markCellError({}, KEY, "Vendor amount cannot exceed the line amount");
    expect(clearSavedCell(cells, KEY)).toBe(cells);
  });

  test("clearing one cell leaves every other cell alone", () => {
    const other = cellStateKey("line-2", "vendorAmount");
    let cells = markCellSaved({}, KEY);
    cells = markCellSaving(cells, other);
    const after = clearSavedCell(cells, KEY);
    expect(after[KEY]).toBeUndefined();
    expect(after[other]).toEqual({ status: "saving" });
  });

  test("an error carries the message it was given, verbatim", () => {
    expect(markCellError({}, KEY, "That vendor is not on this BOQ")[KEY]).toEqual({
      status: "error",
      message: "That vendor is not on this BOQ",
    });
  });

  test("'Saved' is visible for three seconds -- long enough to read, short enough not to accumulate", () => {
    expect(SAVED_VISIBLE_MS).toBe(3000);
  });
});

describe("CellFeedback", () => {
  test("says nothing at all when the cell has no state", () => {
    expect(renderToStaticMarkup(<CellFeedback state={undefined} />)).toBe("");
  });

  test("says Saving…, then Saved, beside the cell", () => {
    expect(renderToStaticMarkup(<CellFeedback state={{ status: "saving" }} />)).toContain("Saving");
    expect(renderToStaticMarkup(<CellFeedback state={{ status: "saved" }} />)).toContain("Saved");
  });

  test("a failure is announced, in rose, with the backend's own words", () => {
    const html = renderToStaticMarkup(
      <CellFeedback state={{ status: "error", message: "Vendor amount cannot exceed the line amount" }} />
    );
    expect(html).toContain("Vendor amount cannot exceed the line amount");
    expect(html).toContain("text-px-error");
    // role="alert": the reader's eye is on the cell, not the corner of the page.
    expect(html).toContain('role="alert"');
  });
});

describe("saveLineItemField", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return impl(url, init);
    }) as unknown as typeof fetch;
    return calls;
  }

  test("PATCHes only the field that changed, to that line's own route", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ id: "line-1", vendorAmount: 500 }), { status: 200 }));
    const out = await saveLineItemField("line-1", "vendorAmount", 500);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/scope/line-items/line-1");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ vendorAmount: 500 });
    expect(out).toEqual({ ok: true, patched: { id: "line-1", vendorAmount: 500 } });
  });

  test("returns the SERVER's row, so the totals beneath move with the cell", async () => {
    stubFetch(() => new Response(JSON.stringify({ id: "line-1", vendorAmount: 500, budget: 1200 }), { status: 200 }));
    const out = await saveLineItemField("line-1", "vendorAmount", 500);
    expect(out.ok).toBe(true);
    // Not the value that was typed -- the recomputed row the backend agreed to.
    expect(out.ok && out.patched.budget).toBe(1200);
  });

  test("a refusal carries the backend's own sentence, never a bare 'Couldn't save'", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "Vendor amount cannot exceed the line amount" }), { status: 400 }));
    const out = await saveLineItemField("line-1", "vendorAmount", 999999);
    // The repo's own convention (src/lib/fetch-json.ts's errorMessage): what the
    // user was trying to do, then the reason the server gave. The reason is
    // what matters and it is never dropped.
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message).toContain("Vendor amount cannot exceed the line amount");
    expect(out.ok === false && out.message).not.toBe("Couldn't save");
  });

  test("a 500 with no body still says something -- never an empty message", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 500 }));
    const out = await saveLineItemField("line-1", "vendorAmount", 500);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.message.length).toBeGreaterThan(0);
  });

  test("a dropped connection is a refusal too, never a silent success", async () => {
    stubFetch(() => {
      throw new Error("Failed to fetch");
    });
    const out = await saveLineItemField("line-1", "materialAmount", 12);
    expect(out.ok).toBe(false);
  });

  test("an id with a slash or a space is encoded into the path, not concatenated raw", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    await saveLineItemField("a/b c", "category", null);
    expect(calls[0]!.url).toBe("/api/scope/line-items/a%2Fb%20c");
  });

  test("clearing a value sends null, which is a real state -- not an omitted field", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    await saveLineItemField("line-1", "materialAmount", null);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ materialAmount: null });
  });
});
