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

function makeData(): Extract<ScopeObjectData, { state: "local" }> {
  const lines = Array.from({ length: N }, (_, i) => ({
    id: `l${i}`, itemCode: `C-${i}`, description: `Item ${i}`, unit: "m2", quantity: "2", rate: "10.00", amount: "20.00", activityId: null, category: null, parentLineItemId: null,
  }));
  return {
    state: "local", boq: { id: "b1", projectId: "p1", title: "Big BOQ", version: 1, status: "approved" } as never, lines, total: 20 * N, syncedAt: null, waitingLineIds: [],
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
afterEach(() => {
  Number.prototype.toLocaleString = realToLocale;
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
    await waitFor(() => expect(enqueued).toEqual([{ lineId: "l2", boqId: "b1", projectId: "p1", patch: { category: "Concrete" } }]));
    await waitFor(() => expect(view.getByTestId("boq-local-note").textContent).toContain("Saved on this laptop"));
    // the draft is gone once it is kept on the laptop
    expect(view.queryAllByTestId("boq-line-save")).toHaveLength(0);

    const other = view.getAllByTestId("boq-line-category-input")[7] as HTMLInputElement;
    fireEvent.input(other, { target: { value: "Steel" } });
    fireEvent.click(view.getByTestId("boq-line-save"));
    await waitFor(() => expect(enqueued.at(-1)).toMatchObject({ lineId: "l7", patch: { category: "Steel" } }));
  });
});
