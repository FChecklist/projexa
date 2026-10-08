import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ShellApi } from "../types";
import type { WorkProgressData } from "./work-progress-adapter";

// P2: the Daily Entry form's activity picker. When the adapter offers several activities the person must choose one, and the screen
// hands that choice to recordProgressOffline; with one activity no picker is shown and no activityId is passed. The writer itself is
// proven against the real outbox in delivery-writes.test.ts.
type Input = Record<string, unknown>;
let calls: Input[];
// spread the real module: DeliveryParts reads refusalText (and others) from it (see CLAUDE.md, mock.module must spread)
const real = await import("./delivery-writes");
mock.module("./delivery-writes", () => ({ ...real, recordProgressOffline: async (_data: unknown, input: Input) => { calls.push(input); return { queued: true, opId: "op-1", tempId: "local-1" }; } }));
const { default: WorkProgressScreen } = await import("./WorkProgressScreen");

const lines = [{ id: "l1", boqId: "b1", itemCode: "01", description: "Blockwork", unit: "m2", quantity: 100 }] as never;
const act = (id: string, name: string) => ({ id, name, unit: null, plannedQuantity: null, categoryId: null });
const data = (form: Extract<WorkProgressData, { state: "local" }>["form"]): WorkProgressData => ({
  state: "local", projectId: "p1", entries: [], syncedAt: 0, namesKnown: { activities: true, lines: true }, form,
});
const shell = { data: { role: "member", projects: [{ id: "p1", name: "Cedar" }] } as never, projectId: "p1", connectivity: "offline", refresh() {}, setProjectId() {}, navigate() {}, writer: {} } as unknown as ShellApi;

beforeEach(() => { calls = []; });
afterEach(cleanup);

function fill(get: (label: string) => HTMLElement) {
  fireEvent.change(get("BOQ line"), { target: { value: "l1" } });
  fireEvent.input(get("Quantity done"), { target: { value: "12" } });
  fireEvent.input(get("Date"), { target: { value: "2026-10-02" } });
}

describe("WorkProgressScreen activity picker (P2)", () => {
  test("several activities: a plain-words picker, and the chosen activity goes to the writer", async () => {
    const form = { mode: "offline" as const, activity: null, activities: [act("a1", "Blockwork"), act("a2", "Plaster")], lines };
    const { getByLabelText, getByTestId, getByText } = render(<WorkProgressScreen shell={shell} params={{}} query={new URLSearchParams()} data={data(form)} />);
    expect(getByText("Which activity is this work for?")).toBeTruthy();
    const picker = getByLabelText("Activity") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Choose an activity", "Blockwork", "Plaster"]);
    expect(picker.required).toBe(true);
    fireEvent.change(picker, { target: { value: "a2" } });
    fill(getByLabelText);
    fireEvent.submit(getByTestId("work-progress-form"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ projectId: "p1", boqLineItemId: "l1", activityId: "a2", quantityDone: 12, entryDate: "2026-10-02" });
  });

  test("one activity: no picker, the activity is named, and no activityId is passed", async () => {
    const form = { mode: "offline" as const, activity: act("a1", "Blockwork"), activities: [], lines };
    const { getByLabelText, getByTestId, queryByTestId, getByText } = render(<WorkProgressScreen shell={shell} params={{}} query={new URLSearchParams()} data={data(form)} />);
    expect(queryByTestId("work-progress-activity")).toBeNull();
    expect(getByText(/Activity: Blockwork\./)).toBeTruthy();
    fill(getByLabelText);
    fireEvent.submit(getByTestId("work-progress-form"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).not.toHaveProperty("activityId");
  });
});
