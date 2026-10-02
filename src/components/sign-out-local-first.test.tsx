/// <reference types="bun-types" />
// LOCAL-FIRST (viii) at the screen: signing out flushes the outbox, then deletes this laptop's copy of the person's workspace
// when nothing is pending, or keeps it and says so when edits are still on their way. SettingsClient's own Sign Out button is
// driven for real; the other three sign-out paths (AccountMenu, AppTopbar, M24Shell's SIGNED_OUT) are checked structurally
// below, the same way module-list-source.test.ts guards the selected-project cookie on every path.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { setActiveLocalUser } from "@/lib/local-first/local-reader";
import { createOutbox, type Outbox } from "@/lib/local-first/outbox";
import { createReplica } from "@/lib/local-first/replica";
import { forgetLastSignOutNotice } from "@/lib/local-first/sign-out";

const order: string[] = [];
const push = mock((href: string) => { order.push(`push ${href}`); });
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/settings",
}));

const toastMessage = mock((text: string) => { order.push(`toast ${text}`); });
mock.module("sonner", () => ({ toast: Object.assign(() => {}, { message: toastMessage, success: () => {}, error: () => {}, info: () => {}, warning: () => {} }) }));

mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: async () => { order.push("supabase.signOut"); }, getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));

const realBoq = await import("@/lib/boq-line-cache");
mock.module("@/lib/boq-line-cache", () => ({ ...realBoq, clearBoqDeviceCopiesOnSignOut: async () => { order.push("boq copy cleared"); } }));

const current: { outbox: Pick<Outbox, "flush"> | null } = { outbox: null };
mock.module("@/lib/local-first/outbox-shared", () => ({
  getSharedOutbox: () => current.outbox,
  peekSharedOutbox: () => current.outbox,
  releaseSharedOutbox: () => { order.push("outbox released"); },
  startOutbox: () => {},
  getDeviceId: () => "dev-test",
}));

const SettingsClient = (await import("./SettingsClient")).default;

const ORG = { organization: { id: "org-1", name: "Meridian", slug: "meridian", created_at: "2026-01-01T00:00:00.000Z" }, role: "member", email: "a@b.test" };
const realFetch = globalThis.fetch;

async function laptop(withPendingEdit: boolean): Promise<{ idb: IDBFactory; server: FakeSyncServer }> {
  const idb = new IDBFactory();
  (globalThis as { indexedDB?: unknown }).indexedDB = idb;
  setActiveLocalUser("u1");
  const server = createFakeSyncServer();
  server.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "x" } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "d", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => "op-1" });
  if (withPendingEdit) {
    await outbox.enqueue({
      functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "Made offline", question: "Q?" }, label: "New RFI",
      creates: { kind: "rfis", id: "local-1" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:local-1", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "local-1" } }); },
    });
  }
  current.outbox = { flush: async () => { order.push("outbox.flush"); return outbox.flush(); } };
  return { idb, server };
}

async function dbNames(idb: IDBFactory) {
  return (await idb.databases()).map((d) => d.name).filter((n) => n?.startsWith("projexa-local"));
}

beforeEach(() => {
  order.length = 0;
  push.mockClear();
  toastMessage.mockClear();
  forgetLastSignOutNotice();
  globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setActiveLocalUser(null);
  current.outbox = null;
});

describe("SettingsClient's Sign Out", () => {
  test("nothing pending: the outbox is flushed first, the laptop's database is deleted, and the person is sent to /login with no notice", async () => {
    const { idb } = await laptop(false);
    expect(await dbNames(idb)).toEqual(["projexa-local:u1"]);
    const view = render(<SettingsClient initialOrgInfo={ORG} initialMembers={[]} />);
    fireEvent.click(view.getByRole("button", { name: /Sign Out/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(await dbNames(idb)).toEqual([]);
    expect(toastMessage).not.toHaveBeenCalled();
    // the local work happens BEFORE the session is ended, never after
    const signOutAt = order.indexOf("supabase.signOut");
    expect(order.indexOf("boq copy cleared")).toBeGreaterThan(-1);
    expect(order.indexOf("boq copy cleared")).toBeLessThan(signOutAt);
    expect(order.indexOf("outbox released")).toBeGreaterThan(-1);
    expect(order.indexOf("outbox released")).toBeLessThan(signOutAt);
  });

  test("an edit made offline is flushed BEFORE the session ends, reaches the server, and only then is the laptop's database deleted", async () => {
    const { idb, server } = await laptop(true);
    const view = render(<SettingsClient initialOrgInfo={ORG} initialMembers={[]} />);
    fireEvent.click(view.getByRole("button", { name: /Sign Out/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(order.indexOf("outbox.flush")).toBeGreaterThan(-1);
    expect(order.indexOf("outbox.flush")).toBeLessThan(order.indexOf("supabase.signOut"));
    expect(server.requests.filter((r) => r.path === "/push")).toHaveLength(1);
    expect(server.getRow("rfis", "srv-rfi-1")).toMatchObject({ data: { subject: "Made offline" } });
    expect(await dbNames(idb)).toEqual([]);
    expect(toastMessage).not.toHaveBeenCalled();
  });

  test("edits still pending (the service is not answering): the database is KEPT and the person is told, in words, before they land on /login", async () => {
    const { idb, server } = await laptop(true);
    server.failNext({ status: 503, path: "/push", times: 10 });
    const view = render(<SettingsClient initialOrgInfo={ORG} initialMembers={[]} />);
    fireEvent.click(view.getByRole("button", { name: /Sign Out/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(await dbNames(idb)).toEqual(["projexa-local:u1"]);
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-1"]); // the work is still there
    db.close();
    expect(toastMessage).toHaveBeenCalledTimes(1);
    expect(toastMessage.mock.calls[0]![0]).toBe("1 change you made on this laptop has not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing it.");
    expect(order.indexOf("toast " + toastMessage.mock.calls[0]![0])).toBeGreaterThan(order.indexOf("supabase.signOut"));
    expect(order.indexOf("push /login")).toBeGreaterThan(order.findIndex((o) => o.startsWith("toast ")));
  });
});

describe("every sign-out path calls the local-first sign-out", () => {
  const ROOT = join(import.meta.dir, "..", "..");
  const EXPLICIT = ["src/components/shell/AccountMenu.tsx", "src/components/AppTopbar.tsx", "src/components/SettingsClient.tsx"];

  for (const rel of EXPLICIT) {
    test(`${rel} flushes and clears the laptop copy BEFORE signOut(), and shows the notice`, () => {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source).toContain('from "@/lib/local-first/sign-out"');
      const localAt = source.indexOf("await finishLocalWorkspaceOnSignOut()");
      const signOutAt = source.indexOf("await supabase.auth.signOut()");
      expect(localAt).toBeGreaterThan(-1);
      expect(localAt).toBeLessThan(signOutAt);
      expect(source.slice(signOutAt, signOutAt + 200)).toContain("toast.message(localNotice");
    });
  }

  test("M24Shell does it on a SIGNED_OUT event too (another tab's sign-out carries no session)", () => {
    const source = readFileSync(join(ROOT, "src/components/shell/M24Shell.tsx"), "utf8");
    const branch = source.slice(source.indexOf('event === "SIGNED_OUT"'));
    expect(branch.slice(0, 1800)).toContain("finishLocalWorkspaceOnSignOut({ userId: leaving })");
    expect(branch.slice(0, 1800)).toContain("toast.message(r.notice");
  });
});
