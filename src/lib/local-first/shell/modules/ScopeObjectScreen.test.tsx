import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ShellApi } from "../types";
import type { ScopeObjectData } from "./scope-adapter";

// AUDIT-100 B15: a BOQ of thousands of lines must stay usable while the person types. Measured in real Chromium on 5,000 lines
// (e2e/lf-lifecycle-large-project.spec.ts): every keystroke in a Category box re-rendered ALL rows, 0.6-1 s of main-thread work each.
// The cost that is countable without a browser is the money formatting every row does when it renders (3 calls a row), so this test
// counts those calls: a keystroke, a parent re-render that hands the screen a NEW shell object (the shell does this on every render), and
// a save must each render only the rows that changed.
// The formatter calls Number.prototype.toLocaleString once per money cell; the spy calls through, so the rendering is the real one.
let formatCalls = 0;
const realToLocale = Number.prototype.toLocaleString;
const { default: ScopeObjectScreen } = await import("./ScopeObjectScreen");

const N = 60;

function makeData(n = N): Extract<ScopeObjectData, { state: "local" }> {
  const lines = Array.from({ length: n }, (_, i) => ({
    id: `l${i}`, itemCode: `C-${i}`, description: `Item ${i}`, unit: "m2", quantity: "2", rate: "10.00", amount: "20.00", activityId: null, category: null, parentLineItemId: null,
  }));
  return {
    state: "local", boq: { id: "b1", projectId: "p1", title: "Big BOQ", version: 1, status: "approved" } as never, lines, total: 20 * n, syncedAt: null, waitingLineIds: [],
  };
}

let enqueued: Array<{ lineId: string; patch: { category: string | null } }>;
const newShell = (): ShellApi =>
  ({
    data: {} as never, projectId: "p1", setProjectId() {}, navigate() {}, connectivity: "offline", refresh() {},
    writer: { enqueue: async (e: { lineId: string; patch: { category: string | null } }) => { enqueued.push(e); } },
  }) as unknown as ShellApi;

beforeEach(() => {
  formatCalls = 0;
  enqueued = [];
  Number.prototype.toLocaleString = function (this: number, ...args: Parameters<typeof realToLocale>) {
    formatCalls += 1;
    return realToLocale.apply(this, args);
  };
});
const realRect = HTMLElement.prototype.getBoundingClientRect;
afterEach(() => {
  Number.prototype.toLocaleString = realToLocale;
  HTMLElement.prototype.getBoundingClientRect = realRect;
  cleanup();
});

describe("ScopeObjectScreen with a large BOQ", () => {
  test("draws every line, and a keystroke renders only the row that was typed in", async () => {
    const data = makeData();
    const { getAllByTestId } = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={data} />);
    expect(getAllByTestId("boq-local-line")).toHaveLength(N);
    const afterFirstDraw = formatCalls;
    expect(afterFirstDraw).toBeGreaterThanOrEqual(N * 2); // first draw: every row formats its rate and its amount

    const box = getAllByTestId("boq-line-category-input")[5] as HTMLInputElement;
    fireEvent.input(box, { target: { value: "S" } });
    fireEvent.input(box, { target: { value: "St" } });
    fireEvent.input(box, { target: { value: "Ste" } });
    expect((getAllByTestId("boq-line-category-input")[5] as HTMLInputElement).value).toBe("Ste");
    // three keystrokes: the one row (2 money cells each time), nothing like 3 x N x 2
    expect(formatCalls - afterFirstDraw, "a keystroke re-rendered rows that did not change").toBeLessThanOrEqual(3 * 2 + 3);
  });

  test("the shell handing the screen a new shell object (it does, on every render) does not render the rows again", async () => {
    const data = makeData();
    const view = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={data} />);
    const afterFirstDraw = formatCalls;
    for (let i = 0; i < 3; i += 1) view.rerender(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={data} />);
    expect(formatCalls - afterFirstDraw, "rows rendered again for a new shell object").toBeLessThanOrEqual(3 + 3); // the total in the footer, nothing else
  });

  test("the Save button still saves exactly that line's draft through the latest shell", async () => {
    const data = makeData();
    const view = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={data} />);
    const box = view.getAllByTestId("boq-line-category-input")[2] as HTMLInputElement;
    fireEvent.input(box, { target: { value: "  Concrete " } });
    fireEvent.click(view.getByTestId("boq-line-save")); // (Enter is driven in real Chromium by e2e/lf-lifecycle-large-project.spec.ts: this test environment cannot raise a real key event)
    await waitFor(() => expect(enqueued).toEqual([{ lineId: "l2", boqId: "b1", projectId: "p1", patch: { category: "Concrete" }, base: { category: null } }]));
    await waitFor(() => expect(view.getByTestId("boq-local-note").textContent).toContain("Saved on this laptop"));
    // the draft is gone once it is kept on the laptop
    expect(view.queryAllByTestId("boq-line-save")).toHaveLength(0);

    const other = view.getAllByTestId("boq-line-category-input")[7] as HTMLInputElement;
    fireEvent.input(other, { target: { value: "Steel" } });
    fireEvent.click(view.getByTestId("boq-line-save"));
    await waitFor(() => expect(enqueued.at(-1)).toMatchObject({ lineId: "l7", patch: { category: "Steel" } }));
  });
});

// AUDIT-100 B15, the first draw: a long BOQ draws only the lines on screen plus a margin (windowing, use-row-window.ts). Drawing all 5,000
// as real rows took 5-9 s in real Chromium (e2e/lf-lifecycle-large-project.spec.ts measures the real thing); here the count of rows and of
// money cells drawn is the deterministic guard. This test environment has no layout, so the page's position is set by hand where needed.
describe("ScopeObjectScreen windowing a 5,000-line BOQ", () => {
  const BIG = 5000;

  test("the first draw is tens of rows, not 5,000, and the table still says it has 5,001 rows; the total is of every line", () => {
    const data = makeData(BIG);
    const view = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={data} />);
    const drawn = view.getAllByTestId("boq-local-line");
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.length, "every line was drawn: the table is not windowed").toBeLessThanOrEqual(60);
    // was 2 money cells x 5,000 rows = 10,000 format calls before windowing
    expect(formatCalls, "money cells formatted on the first draw").toBeLessThanOrEqual(60 * 2 + 1);
    const table = view.getByTestId("boq-local-table");
    expect(table.getAttribute("aria-rowcount")).toBe(String(BIG + 1));
    expect(table.getAttribute("data-windowed")).toBe("true");
    expect(drawn[0].getAttribute("aria-rowindex")).toBe("2");
    // the lines not drawn are one spacer row, as tall as they are (no layout here: the estimate, 49 px a line)
    const spacers = view.getAllByTestId("boq-row-spacer");
    expect(spacers).toHaveLength(1);
    expect(spacers[0].getAttribute("aria-hidden")).toBe("true");
    expect(Number.parseFloat(spacers[0].style.height)).toBe((BIG - drawn.length) * 49);
    expect(view.getByTestId("boq-local-total").textContent).toContain("100,000.00");
  });

  test("scrolling far down draws the lines there, and the line being typed in stays drawn with its draft and its focus", async () => {
    const data = makeData(BIG);
    const view = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={data} />);
    const box = view.getAllByTestId("boq-line-category-input")[3] as HTMLInputElement;
    box.focus();
    fireEvent.focusIn(box);
    fireEvent.input(box, { target: { value: "Ste" } });

    // the table body is now 200,000 px above the screen's top: lines 4081.. are on screen
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const top = this.tagName === "TBODY" ? -200_000 : 0;
      return { top, bottom: top + 245_000, left: 0, right: 1000, width: 1000, height: this.tagName === "TBODY" ? 245_000 : 0, x: 0, y: top, toJSON() {} } as DOMRect;
    };
    fireEvent.scroll(document);
    await waitFor(() => expect(view.container.querySelector('[data-line-id="l4090"]')).not.toBeNull());
    const ids = view.getAllByTestId("boq-local-line").map((r) => r.getAttribute("data-line-id"));
    expect(ids.length).toBeLessThanOrEqual(60);
    expect(ids, "the focused line was dropped by the scroll").toContain("l3");
    expect(ids).not.toContain("l40");
    const still = view.container.querySelector('[data-line-id="l3"] [data-testid="boq-line-category-input"]') as HTMLInputElement;
    expect(still).toBe(box); // the same element: React did not unmount it, so the browser's focus and caret stay in it
    expect(still.value).toBe("Ste");
    expect(document.activeElement).toBe(box);
    // the far line's row index is its real position, for a screen reader
    expect(view.container.querySelector('[data-line-id="l4090"]')?.getAttribute("aria-rowindex")).toBe("4092");
    // two spacers above (before and after the pinned line) and one below
    expect(view.getAllByTestId("boq-row-spacer")).toHaveLength(3);
  });

  test("printing draws every line, and drawing goes back to the window afterwards", async () => {
    const PRINTED = 400; // over the threshold, so it is windowed; (5,000 real rows take this test environment ~15 s to build)
    const view = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={makeData(PRINTED)} />);
    expect(view.getAllByTestId("boq-local-line").length).toBeLessThanOrEqual(60);
    window.dispatchEvent(new Event("beforeprint"));
    // synchronously, before the print layout is taken
    expect(view.getAllByTestId("boq-local-line")).toHaveLength(PRINTED);
    expect(view.queryAllByTestId("boq-row-spacer")).toHaveLength(0);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(view.getAllByTestId("boq-local-line").length).toBeLessThanOrEqual(60));
  });

  test("a short BOQ (under the windowing threshold) is drawn in full, as before", () => {
    const view = render(<ScopeObjectScreen shell={newShell()} params={{}} query={new URLSearchParams()} data={makeData(150)} />);
    expect(view.getAllByTestId("boq-local-line")).toHaveLength(150);
    expect(view.getByTestId("boq-local-table").getAttribute("data-windowed")).toBe("false");
  });
});

describe("G-14: a conflict is shown in plain words and the person chooses", () => {
  test("both values are shown, and Keep mine / Keep theirs call the writer with that edit and choice", async () => {
    const data = { ...makeData(3), conflicts: [{ editId: "e1", lineId: "l1", mine: "CONF-B", theirs: "CONF-A" }] };
    const resolved: Array<[string, string]> = [];
    const shell = { ...newShell(), writer: { enqueue: async () => {}, resolveConflict: async (id: string, choice: string) => { resolved.push([id, choice]); }, flush: async () => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" }) } } as unknown as ShellApi;
    const { getAllByTestId, getByTestId } = render(<ScopeObjectScreen shell={shell} params={{}} query={new URLSearchParams()} data={data} />);
    const panel = getByTestId("boq-line-conflict");
    expect(panel.textContent).toContain("Someone else changed this to “CONF-A” while you changed it to “CONF-B”");
    expect(getAllByTestId("boq-line-conflict")).toHaveLength(1); // only the conflicted line
    fireEvent.click(getByTestId("boq-conflict-mine"));
    await waitFor(() => expect(resolved).toEqual([["e1", "mine"]]));
    fireEvent.click(getByTestId("boq-conflict-theirs"));
    await waitFor(() => expect(resolved).toEqual([["e1", "mine"], ["e1", "theirs"]]));
  });

  test("a save passes what the person SAW as the base of the edit", async () => {
    const data = makeData(3);
    const shell = newShell();
    const { getAllByTestId } = render(<ScopeObjectScreen shell={shell} params={{}} query={new URLSearchParams()} data={data} />);
    const box = getAllByTestId("boq-line-category-input")[1] as HTMLInputElement;
    fireEvent.input(box, { target: { value: "Civil" } });
    fireEvent.click(getAllByTestId("boq-line-save")[0]!);
    await waitFor(() => expect(enqueued).toHaveLength(1));
    expect(enqueued[0]).toMatchObject({ lineId: "l1", patch: { category: "Civil" }, base: { category: null } });
  });
});
