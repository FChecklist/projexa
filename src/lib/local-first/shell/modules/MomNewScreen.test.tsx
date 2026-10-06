import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ShellApi } from "../types";
import type { MomsListData } from "./moms-adapter";

// The new-meeting form (G-15): the screen hands exactly what the person typed to createMomOffline (attendees and agenda split on lines or
// commas) and says in words what happened; the writer itself is proven against the real outbox in documents-writes.test.ts.
type Input = { projectId: string; title: string; scheduledAt: string; meetingType?: string | null; attendees?: readonly string[]; agenda?: readonly string[]; minutes?: string | null };
let calls: Input[];
let answer: { ok: true; opId: string } | { ok: false; message: string };
mock.module("./documents-writes", () => ({ createMomOffline: async (_data: unknown, input: Input) => { calls.push(input); return answer; } }));
const { default: MomNewScreen } = await import("./MomNewScreen");

const data: MomsListData = { state: "local", projectId: "p1", syncedAt: null, rows: [] };
const shell = (connectivity: "online" | "offline" = "offline") =>
  ({ data: { role: "manager", projects: [{ id: "p1", name: "Cedar" }] } as never, projectId: "p1", connectivity, refresh() {}, setProjectId() {}, navigate() {}, writer: {} }) as unknown as ShellApi;

beforeEach(() => { calls = []; answer = { ok: true, opId: "op-1" }; });
afterEach(cleanup);

describe("MomNewScreen", () => {
  test("splits attendees and agenda on lines or commas, passes the rest as typed, and says it is saved on the laptop", async () => {
    const { getByLabelText, getByTestId } = render(<MomNewScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    fireEvent.input(getByLabelText("Title"), { target: { value: "Site meeting" } });
    fireEvent.input(getByLabelText("Attendees"), { target: { value: "Asha, Ravi\nMeena" } });
    fireEvent.input(getByLabelText("Agenda"), { target: { value: "Slab\n\nSafety" } });
    fireEvent.input(getByLabelText("Minutes"), { target: { value: "Pour agreed." } });
    fireEvent.submit(getByTestId("mom-new-form"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ projectId: "p1", title: "Site meeting", attendees: ["Asha", "Ravi", "Meena"], agenda: ["Slab", "Safety"], minutes: "Pour agreed." });
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    expect(getByTestId("save-note").textContent).toContain("will be sent to the server when you are connected");
  });

  test("a refusal is shown in the writer's own words and nothing is cleared", async () => {
    answer = { ok: false, message: "Give the meeting a title (up to 300 letters)." };
    const { getByLabelText, getByTestId } = render(<MomNewScreen shell={shell()} params={{}} query={new URLSearchParams()} data={data} />);
    fireEvent.input(getByLabelText("Title"), { target: { value: "x" } });
    fireEvent.submit(getByTestId("mom-new-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(getByTestId("save-note").textContent).toBe("Give the meeting a title (up to 300 letters).");
    expect((getByLabelText("Title") as HTMLInputElement).value).toBe("x");
  });

  test("a project that has not finished copying says so instead of showing a form", () => {
    const { getByTestId, queryByTestId } = render(<MomNewScreen shell={shell()} params={{}} query={new URLSearchParams()} data={{ state: "not_synced", projectId: "p1" }} />);
    expect(getByTestId("mom-new")).toBeTruthy();
    expect(queryByTestId("mom-new-form")).toBeNull();
  });
});
