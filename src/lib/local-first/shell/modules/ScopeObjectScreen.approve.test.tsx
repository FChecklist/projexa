import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ShellApi } from "../types";
import type { ScopeObjectData } from "./scope-adapter";

// BOQ detail parity: the laptop-first BOQ screen had NO Approve action at all (the online page has one), so a manager never saw it. It is
// now offered on a submitted BOQ to a role that may approve, only when online, through the same /api/scope/<id>/approve the online page uses,
// and the server's "independent approver" refusal for the creator is shown in words.
const revalidations: { kind: string; projectId: string }[] = [];
mock.module("../../replica-shared", () => ({ revalidateViaSharedReplica: async (c: { kind: string; projectId: string }) => { revalidations.push(c); } }));
const { default: ScopeObjectScreen } = await import("./ScopeObjectScreen");

const data = (status = "submitted"): Extract<ScopeObjectData, { state: "local" }> => ({
  state: "local", boq: { id: "b1", projectId: "p1", title: "Villa", version: 1, status } as never, syncedAt: null, waitingLineIds: [], total: 20,
  lines: [{ id: "l1", itemCode: "A", description: "Slab", unit: "m3", quantity: "2", rate: "10", amount: "20", activityId: null, category: null, parentLineItemId: null } as never],
});
const shell = (role: string | null, connectivity: "online" | "offline" = "online") =>
  ({ data: { role, userId: "u1", projects: [] } as never, projectId: "p1", setProjectId() {}, navigate() {}, connectivity, refresh() {}, writer: {} }) as unknown as ShellApi;
const view = (role: string | null, c: "online" | "offline" = "online", status = "submitted") =>
  render(<ScopeObjectScreen shell={shell(role, c)} params={{}} query={new URLSearchParams()} data={data(status)} />);

let calls: { url: string; method?: string }[];
let answer: { status: number; body: unknown };
beforeEach(() => {
  calls = [];
  revalidations.length = 0;
  answer = { status: 200, body: {} };
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: { method?: string }) => {
    calls.push({ url, method: init?.method });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
});
afterEach(cleanup);

describe("laptop-first BOQ screen: Approve", () => {
  test("a manager (pm) sees an enabled Approve on a submitted BOQ and it posts to the same route the online page uses", async () => {
    const { getByTestId } = view("pm");
    const button = getByTestId("boq-local-approve") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(getByTestId("boq-local-approve-note").textContent).toBe("Approved."));
    expect(calls).toEqual([{ url: "/api/scope/b1/approve", method: "POST" }]);
    expect(getByTestId("boq-local-status").textContent).toBe("approved");
  });

  test("an admin sees it too; a role that may not approve sees it disabled with the same words as online", () => {
    expect((view("admin").getByTestId("boq-local-approve") as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    const member = view("member");
    expect((member.getByTestId("boq-local-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(member.getByTestId("boq-local-approve-blocked").textContent).toContain("Only an owner, admin or project manager can approve a BOQ.");
  });

  test("a laptop that does not know the role yet still offers it (the server decides)", () => {
    expect((view(null).getByTestId("boq-local-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  test("the creator: the server's independent-approver refusal is shown in words and Approve then stays disabled", async () => {
    answer = { status: 403, body: { error: "Independent approver required: you created this BOQ." } };
    const { getByTestId } = view("pm");
    fireEvent.click(getByTestId("boq-local-approve"));
    await waitFor(() => expect(getByTestId("boq-local-approve-note").getAttribute("data-ok")).toBe("0"));
    expect(getByTestId("boq-local-approve-note").textContent).toContain("Independent approver");
    expect(getByTestId("boq-local-approve-note").textContent).toContain("You created this BOQ, so someone else must approve it");
    expect((getByTestId("boq-local-approve") as HTMLButtonElement).disabled).toBe(true);
  });

  test("offline: disabled with a plain reason, and nothing is sent", () => {
    const { getByTestId } = view("pm", "offline");
    expect((getByTestId("boq-local-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId("boq-local-approve-blocked").textContent).toContain("needs a connection");
    fireEvent.click(getByTestId("boq-local-approve"));
    expect(calls).toHaveLength(0);
  });

  test("a BOQ that is not submitted has no Approve", () => {
    expect(view("pm", "online", "draft").queryByTestId("boq-local-approve")).toBeNull();
    cleanup();
    expect(view("pm", "online", "approved").queryByTestId("boq-local-approve")).toBeNull();
  });

  test("opening a not-yet-approved BOQ online brings this project's headers and lines up to date once (a just-submitted status arrives)", async () => {
    view("pm", "online", "draft");
    await waitFor(() => expect(revalidations.map((r) => r.kind)).toEqual(["boqs", "boq_lines"]));
  });
});
