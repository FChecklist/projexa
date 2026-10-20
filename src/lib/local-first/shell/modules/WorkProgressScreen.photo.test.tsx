import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ShellApi } from "../types";
import type { WorkProgressData } from "./work-progress-adapter";

// R-48 parity: the laptop-first Daily Entry form has the optional Site photo field. The photo rides a follow-up queue tied to the entry's
// op (the outbox cannot carry files), the screen shows "Photo waiting to upload", and a refusal or a lost photo is told, never dropped.
type Input = Record<string, unknown>;
let writes: Input[];
let queued: { opId: string; projectId: string; file: Blob; fileName: string }[];
let jobs: unknown[];
let notices: unknown[];
let keep: boolean;
const real = await import("./delivery-writes");
mock.module("./delivery-writes", () => ({ ...real, recordProgressOffline: async (_d: unknown, input: Input) => { writes.push(input); return { queued: true, opId: "op-9", tempId: "local-9" }; } }));
const { default: WorkProgressScreen } = await import("./WorkProgressScreen");

const lines = [{ id: "l1", boqId: "b1", itemCode: "01", description: "Blockwork", unit: "m2", quantity: 100 }] as never;
const data: WorkProgressData = {
  state: "local", projectId: "p1", entries: [], syncedAt: 0, namesKnown: { activities: true, lines: true },
  form: { mode: "offline", activity: { id: "a1", name: "Blockwork", unit: null, plannedQuantity: null, categoryId: null }, activities: [{ id: "a1", name: "Blockwork", unit: null, plannedQuantity: null, categoryId: null }], lines },
};
const photos = {
  add: async (input: (typeof queued)[number]) => { queued.push(input); return keep ? { id: "ph-1" } : null; },
  list: async () => jobs, notices: async () => notices, dismissNotice: async () => {}, flush: async () => ({}), entryApplied: async () => {}, entryRejected: async () => {},
};
const shell = (withPhotos = true) => ({ data: { role: "member", projects: [{ id: "p1", name: "Cedar" }] } as never, projectId: "p1", connectivity: "offline", refresh() {}, setProjectId() {}, navigate() {}, writer: {}, ...(withPhotos ? { photos } : {}) }) as unknown as ShellApi;

beforeEach(() => { writes = []; queued = []; jobs = []; notices = []; keep = true; });
afterEach(cleanup);

function fill(get: (label: string) => HTMLElement) {
  fireEvent.change(get("BOQ line"), { target: { value: "l1" } });
  fireEvent.input(get("Quantity done"), { target: { value: "12" } });
  fireEvent.input(get("Date"), { target: { value: "2026-10-02" } });
}
const picture = () => new File(["x"], "slab.jpg", { type: "image/jpeg" });

describe("Daily Entry: Site photo (R-48 parity)", () => {
  test("the form has an optional image file field", () => {
    const { getByLabelText } = render(<WorkProgressScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    const input = getByLabelText("Site photo") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.required).toBe(false);
  });

  test("saving with a photo keeps the entry AND hands the photo to the queue, tied to the entry's op id", async () => {
    const { getByLabelText, getByTestId } = render(<WorkProgressScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    fill(getByLabelText);
    fireEvent.change(getByLabelText("Site photo"), { target: { files: [picture()] } });
    fireEvent.submit(getByTestId("work-progress-form"));
    await waitFor(() => expect(queued).toHaveLength(1));
    expect(writes).toHaveLength(1);
    expect(queued[0]).toMatchObject({ opId: "op-9", projectId: "p1", fileName: "slab.jpg" });
    await waitFor(() => expect(getByTestId("work-progress-photo-note").textContent).toContain("kept on this laptop"));
  });

  test("saving without a photo does not touch the photo queue", async () => {
    const { getByLabelText, getByTestId } = render(<WorkProgressScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    fill(getByLabelText);
    fireEvent.submit(getByTestId("work-progress-form"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(queued).toHaveLength(0);
  });

  test("a photo the laptop could not keep is told in words (the entry itself is saved)", async () => {
    keep = false;
    const { getByLabelText, getByTestId } = render(<WorkProgressScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    fill(getByLabelText);
    fireEvent.change(getByLabelText("Site photo"), { target: { files: [picture()] } });
    fireEvent.submit(getByTestId("work-progress-form"));
    await waitFor(() => expect(getByTestId("work-progress-photo-note").textContent).toContain("photo could not be kept"));
    expect(writes).toHaveLength(1);
  });

  test("a photo waiting is shown as 'Photo waiting to upload', and a drop notice is shown in words", async () => {
    jobs = [{ id: "ph-1", opId: "op-9", projectId: "p1", fileName: "slab.jpg", state: "waiting_entry" }];
    notices = [{ id: "n1", at: 1, fileName: "old.jpg", message: "The server did not accept the photo old.jpg" }];
    const { findByTestId, getByTestId } = render(<WorkProgressScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    expect((await findByTestId("work-progress-photo-waiting")).textContent).toContain("Photo waiting to upload: slab.jpg");
    expect(getByTestId("work-progress-photo-notice").textContent).toContain("did not accept the photo");
  });
});
