import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY } from "../replica";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";
import { shellManifestKey } from "./manifest-cache";
import type { Outbox, OutboxEvent, OutboxState } from "../outbox";
import { SCREENS_WITH_OWN_OUTBOX_CARD, shellShowsOutboxCard } from "./shell-outbox";

// The on-laptop shell shows the person's outbox card (OutboxAttention) on EVERY screen: a change the server turned down while the
// person is on work progress, labour, materials, documents ... is said in words there, not only on the dashboard (found by lf-e10a in a
// real Chromium: e2e/lf-delivery-writes.spec.ts "a change the server turns down reaches the person ..."). And never twice: the
// dashboard screens render their own card.
//
// The person's shared outbox is replaced by a fake that already holds one turned-down change (the REAL module is spread first, see
// CLAUDE.md's mock.module() note); everything else is the real shell.

const NOTICE = "Attendance was not saved. Your role in this organisation does not allow this change. It was undone on this laptop.";
const state: OutboxState = {
  pending: 0, retrying: 0, conflicts: [], blocked: [], checking: [], attention: [], drafts: [],
  notices: [{ opId: "op-1", functionId: "record_attendance", message: NOTICE, at: 1 }],
  status: "idle", updateRequired: null, storageWarning: false,
} as unknown as OutboxState;
let started: string[] = [];
const fake = {
  flush: async () => ({ sent: 0, applied: 0 }),
  subscribe: (_fn: (e: OutboxEvent) => void) => () => {},
  refresh: async () => state,
  getState: () => state,
  dismissNotice: async () => {},
} as unknown as Outbox;
const realOutboxShared = await import("../outbox-shared");
mock.module("../outbox-shared", () => ({
  ...realOutboxShared,
  getSharedOutbox: (userId: string) => {
    started.push(userId);
    return fake;
  },
  peekSharedOutbox: () => fake,
}));
const { default: LocalShell } = await import("./LocalShell");

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "member", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`https://px.test${path}`);
}

beforeEach(async () => {
  const idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  started = [];
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: [], at: 1 });
  db.close();
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: "member", org_id: "orgA" }, projects: [{ id: "p1", name: "Harbor View", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
});
afterEach(() => cleanup());

describe("the shell's outbox card", () => {
  test("on a delivery screen (labour): the person's outbox is started and a turned-down change is said in words", async () => {
    go("/local/labour?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    const card = await findByTestId("outbox-attention");
    expect(card.textContent).toContain(NOTICE);
    expect(started).toContain("u1");
  });

  test("on a screen of another cluster (documents) too: one card, the shell's", async () => {
    go("/local/documents?projectId=p1");
    const { findByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("outbox-attention");
    expect(getAllByTestId("outbox-attention")).toHaveLength(1);
  });

  test("on the dashboard, which renders its own card: still exactly ONE card", async () => {
    go("/local/dashboard?projectId=p1");
    const { findByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("outbox-attention");
    await new Promise((r) => setTimeout(r, 200));
    await waitFor(() => expect(getAllByTestId("outbox-attention")).toHaveLength(1));
  });
});

describe("shellShowsOutboxCard", () => {
  test("every screen but the ones that render their own; the home page ('/', no route) too", () => {
    expect(shellShowsOutboxCard("/labour")).toBe(true);
    expect(shellShowsOutboxCard("/work-progress")).toBe(true);
    expect(shellShowsOutboxCard(null)).toBe(true);
    expect(shellShowsOutboxCard("/dashboard")).toBe(false);
    expect(shellShowsOutboxCard("/dashboard/project")).toBe(false);
  });

  test("the exception's premise holds: each excluded screen really renders its own card", async () => {
    const { ROUTES } = await import("./clusters/overview");
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./modules/DashboardLocalScreen.tsx", import.meta.url), "utf8");
    expect(source).toContain("<OutboxAttention");
    for (const pattern of SCREENS_WITH_OWN_OUTBOX_CARD) {
      const route = ROUTES.find((r) => r.pattern === pattern);
      expect(route?.load.toString()).toContain("DashboardLocalScreen");
    }
  });
});
