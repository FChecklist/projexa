import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import BillingMilestonesScreen from "./BillingMilestonesScreen";
import type { ShellApi } from "../types";
import type { BillingData } from "./billing-adapter";

// R-94/R-95: an approved claim on the laptop-first Billing Milestones screen offers a real Invoice action (it used to say invoicing is
// "done on the server" with no way there). Online: the action; offline: a plain note; a draft not yet sent, a read-only role or a claim
// in any other status: no action.
afterEach(cleanup);

const claim = (id: string, status: string, waiting = false) => ({
  id, description: `Claim ${id}`, status, scheduledDate: "2026-10-01", rejectionReason: null, customerName: "Lakeview", interimBillId: null, steps: [], waiting,
});
const data = (...claims: ReturnType<typeof claim>[]): BillingData =>
  ({ state: "local", projectId: "p1", claims, customerHidden: false, customerNames: "local", syncedAt: 1 }) as unknown as BillingData;
const shell = (over: { connectivity?: "online" | "offline"; role?: string } = {}) =>
  ({ projectId: "p1", connectivity: over.connectivity ?? "online", refresh() {}, navigate() {}, data: { role: over.role ?? "manager", projects: [{ id: "p1", name: "Cedar" }] } }) as unknown as ShellApi;
const draw = (s: ShellApi, d: BillingData) => render(<BillingMilestonesScreen shell={s} params={{}} query={new URLSearchParams()} data={d} />);

describe("Billing Milestones screen: Invoice on an approved claim", () => {
  test("online, an approved sent claim has the Invoice action and no other claim has one", () => {
    const v = draw(shell(), data(claim("a", "client_approved"), claim("b", "submitted"), claim("c", "client_approved", true)));
    expect(v.getAllByTestId("claim-invoice-open")).toHaveLength(1);
    const rows = v.getAllByTestId("billing-row");
    expect(rows[0]!.querySelector('[data-testid="claim-invoice-open"]')).not.toBeNull();
    expect(rows[1]!.querySelector('[data-testid="billing-invoice-action"]')).toBeNull();
    expect(rows[2]!.querySelector('[data-testid="billing-invoice-action"]')).toBeNull();
  });
  test("the old 'invoicing is done on the server' sentence is gone", () => {
    const v = draw(shell(), data(claim("a", "client_approved")));
    expect(v.getByTestId("server-only").textContent).not.toContain("invoicing a milestone is done on the server");
  });
  test("offline it says invoicing needs a connection, with no button", () => {
    const v = draw(shell({ connectivity: "offline" }), data(claim("a", "client_approved")));
    expect(v.queryByTestId("claim-invoice-open")).toBeNull();
    expect(v.getByTestId("billing-invoice-offline").textContent).toContain("needs a connection");
  });
  test("a read-only role gets no Invoice action", () => {
    const v = draw(shell({ role: "client_viewer" }), data(claim("a", "client_approved")));
    expect(v.queryByTestId("billing-invoice-action")).toBeNull();
  });
});
