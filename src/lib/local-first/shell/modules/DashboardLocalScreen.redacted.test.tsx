import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ShellApi } from "../types";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
import DashboardLocalScreen from "./DashboardLocalScreen";
import { isProjectDashboard, loadDashboard, projectDashboardSnapshotName } from "./dashboard-adapter";

// lf-e10c, found by e2e/lf-overview-figures.spec.ts in a real browser: below the manager rank the REAL project dashboard endpoint
// (compliance-tracker src/app/api/v1/projexa/dashboard/[projectId]/route.ts) nulls every money field and says so with
// `financialsRedacted: true`. The laptop's dashboard ignored that flag and drew each nulled figure as "Not set" -- telling a client viewer
// that the project has no contract value, no budget and nothing spent, which is false. A hidden figure must be ABSENT, with the reason.

const ROLE = "client_viewer";
const REDACTED = {
  projectId: "p1", progressPercent: 47.5, percentByValue: null, contractValue: null, budget: null, expenses: null,
  delayedTaskCount: 1, taskCount: 8, permitsExpiringCount: 2, revenue: null, projectValue: null, earnedValue: null, progressByBoqValuePct: null,
  financialsRedacted: true,
};
const FULL = { projectId: "p1", progressPercent: 47.5, percentByValue: 38.25, contractValue: 1250000, budget: 1100000, expenses: 1180000, delayedTaskCount: 1, taskCount: 8, permitsExpiringCount: 2 };

let idb: IDBFactory;
const shellData = (): ShellData => ({ userId: "u1", name: "Asha", email: "a@x.test", role: ROLE, orgId: "orgA", idb, projects: [{ id: "p1", name: "Harbor View Tower" }] });
const fakeShell = (data: ShellData): ShellApi => ({
  data, projectId: "p1", setProjectId() {}, navigate() {}, connectivity: "offline", refresh() {},
  writer: { list: async () => [], enqueue: async () => { throw new Error("no"); }, flush: async () => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" }), notices: async () => [], dismissNotice: async () => {} },
});

async function drawWith(body: unknown) {
  const data = shellData();
  await snapshotCacheFor({ userId: "u1", role: ROLE, idb }).write(projectDashboardSnapshotName("p1"), body);
  const loaded = await loadDashboard(data, "p1");
  return render(<DashboardLocalScreen shell={fakeShell(data)} params={{}} query={new URLSearchParams()} data={loaded} />);
}

const labels = (card: HTMLElement) => [...card.querySelectorAll("dt")].map((d) => d.textContent);

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
});
afterEach(() => cleanup());

describe("the server's redacted figures (below the manager rank)", () => {
  test("the real redacted answer is still a valid snapshot (the flag does not make it unreadable)", () => {
    expect(isProjectDashboard(REDACTED)).toBe(true);
  });

  test("money rows are absent, never 'Not set', and the reason is said once", async () => {
    const { getByTestId } = await drawWith(REDACTED);
    const card = getByTestId("overview-dashboard-figures");
    expect(labels(card)).toEqual(["Progress", "Delayed tasks", "Permits expiring"]);
    expect(card.textContent).not.toContain("Not set");
    expect(getByTestId("overview-dashboard-money-hidden").textContent).toBe("Money figures are shown to managers and above.");
  });

  test("the non-money figures are the server's own", async () => {
    const { getByTestId } = await drawWith(REDACTED);
    const dds = [...getByTestId("overview-dashboard-figures").querySelectorAll("dd")].map((d) => d.textContent);
    expect(dds).toEqual(["47.5%", "1", "2"]);
  });

  test("an unredacted answer (a manager's) still shows every money row, and no hidden-money note", async () => {
    const { getByTestId, queryByTestId } = await drawWith(FULL);
    expect(labels(getByTestId("overview-dashboard-figures"))).toEqual(["Progress", "% complete by BOQ value", "Contract value", "Budget", "Spent", "Delayed tasks", "Permits expiring"]);
    expect(queryByTestId("overview-dashboard-money-hidden")).toBeNull();
  });
});
