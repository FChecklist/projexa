/// <reference types="bun-types" />
// LOCAL-FIRST R9 at the three Sign out buttons (AccountMenu, AppTopbar, SettingsClient): each is clicked for real and must, through
// signOutEverywhere,
//   * run the workspace step (flush + delete/keep this laptop's copy) BEFORE the durable identity is cleared,
//   * leave the identity mirror EMPTY in both copies (localStorage `px-identity-v1` and the device database's meta),
//   * tell the service worker to drop THIS person's release caches (CLEAR_PERSON),
//   * end the Supabase session -- and, when Supabase cannot be reached, clear the session cookies/storage by hand,
//   * keep a pending edit's data and show the notice,
// while keeping each button's own behaviour (selected-project cookie, BOQ device copy, toast, /login).
//
// Boundaries faked, nothing else: the router, sonner, the Supabase browser client, the service worker client, the shared outbox, the
// BOQ copy. A Radix dropdown cannot open in happy-dom (it needs layout), so its parts are drawn as plain elements (same as
// InstallMenuItem.test.tsx). The private kit (@fchecklist/veridian-ui-kit) is not installable in every environment, so AppTopbar's
// header and its sibling widgets are stubbed down to the slot that carries the account menu. Real modules are SPREAD (CLAUDE.md's
// mock.module() gotcha).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { openDeviceMeta } from "@/lib/local-first/device-meta";
import type { DurableIdentity } from "@/lib/local-first/identity";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { setActiveLocalUser } from "@/lib/local-first/local-reader";
import { createOutbox, type Outbox } from "@/lib/local-first/outbox";
import { createReplica } from "@/lib/local-first/replica";
import { META_KEYS } from "@/lib/local-first/release/release-constants";
import { forgetLastSignOutNotice } from "@/lib/local-first/sign-out";
import { SIGN_OUT_AND_DELETE_LABEL } from "@/lib/local-first/sign-out-everywhere";

// identity.ts binds the service worker client at load: it (and everything importing it) is loaded AFTER the mocks below.
const IDENTITY_STORAGE_KEY = "px-identity-v1";
const order: string[] = [];
const identityPresent = () => (localStorage.getItem(IDENTITY_STORAGE_KEY) ? "identity present" : "identity gone");

const push = mock((href: string) => { order.push(`push ${href}`); });
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/settings",
}));

const toastMessage = mock((text: string) => { order.push(`toast ${text}`); });
mock.module("sonner", () => ({ toast: Object.assign(() => {}, { message: toastMessage, success: () => {}, error: () => {}, info: () => {}, warning: () => {} }) }));

const supabaseMode: { reachable: boolean } = { reachable: true };
const realSupabase = await import("@/lib/supabase/client");
mock.module("@/lib/supabase/client", () => ({
  ...realSupabase,
  createClient: () => ({
    auth: {
      signOut: async () => {
        order.push(`supabase.signOut (${identityPresent()})`);
        if (!supabaseMode.reachable) return { error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } };
        return { error: null };
      },
      getUser: async () => ({ data: { user: { id: "u1" } } }),
    },
  }),
}));

// The page's real service worker client talks to this controller: every message is recorded and answered on its private port.
const clearPerson = mock((personId: string | null) => { order.push(`sw.clearPerson ${personId} (${identityPresent()})`); });
const swMessages: Record<string, unknown>[] = [];
const fakeController = {
  postMessage(message: Record<string, unknown>, transfer: { postMessage(m: unknown): void }[]) {
    swMessages.push(message);
    if (message.type === "CLEAR_PERSON") clearPerson((message.personId as string | undefined) ?? null);
    transfer[0]?.postMessage({ ok: true, type: message.type, cleared: true });
  },
};
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: { controller: fakeController, getRegistration: async () => ({ active: fakeController }), register: async () => ({}), ready: Promise.resolve({}) },
});

const realBoq = await import("@/lib/boq-line-cache");
mock.module("@/lib/boq-line-cache", () => ({ ...realBoq, clearBoqDeviceCopiesOnSignOut: async () => { order.push("boq copy cleared"); } }));

const current: { outbox: Pick<Outbox, "flush"> | null } = { outbox: null };
mock.module("@/lib/local-first/outbox-shared", () => ({
  getSharedOutbox: () => current.outbox,
  peekSharedOutbox: () => current.outbox,
  releaseSharedOutbox: () => { order.push(`workspace step done (${identityPresent()})`); },
  startOutbox: () => {},
  getDeviceId: () => "dev-test",
}));

const realDropdown = await import("@/components/ui/dropdown-menu");
const Plain = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
mock.module("@/components/ui/dropdown-menu", () => ({
  ...realDropdown,
  DropdownMenu: Plain,
  DropdownMenuTrigger: Plain,
  DropdownMenuContent: Plain,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
mock.module("@fchecklist/veridian-ui-kit/shell", () => ({ AppHeader: ({ userMenuSlot }: { userMenuSlot?: ReactNode }) => <header>{userMenuSlot}</header> }));
mock.module("@/components/AppSidebar", () => ({ MobileSidebarTrigger: () => null }));
mock.module("@/components/search-command", () => ({ SearchTrigger: () => null }));
mock.module("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
mock.module("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));

const { resetDeliberateSignOutForTests, IDENTITY_STORAGE_KEY: REAL_KEY } = await import("@/lib/local-first/identity");
const { getIdentityStore } = await import("@/lib/local-first/sign-out-everywhere");
if (REAL_KEY !== IDENTITY_STORAGE_KEY) throw new Error("the identity storage key changed: update this test");
const AccountMenu = (await import("./shell/AccountMenu")).default;
const { AppTopbar } = await import("./AppTopbar");
const SettingsClient = (await import("./SettingsClient")).default;

const ORG = { organization: { id: "org-1", name: "Meridian", slug: "meridian", created_at: "2026-01-01T00:00:00.000Z" }, role: "member", email: "a@b.test" };
const PATHS: { name: string; mount: () => ReturnType<typeof render> }[] = [
  { name: "AccountMenu", mount: () => render(<AccountMenu email="a@b.test" />) },
  { name: "AppTopbar", mount: () => render(<AppTopbar />) },
  { name: "SettingsClient", mount: () => render(<SettingsClient initialOrgInfo={ORG} initialMembers={[]} />) },
];

const IDENTITY: DurableIdentity = {
  userId: "u1", email: "a@b.test", name: "A", orgId: "org-1", role: "member", lastRefreshAt: 1, signedInAt: 1,
  session: { access_token: "at", refresh_token: "rt", expires_at: null },
};

let idb: IDBFactory;
async function laptop(withPendingEdit: boolean) {
  idb = new IDBFactory();
  (globalThis as { indexedDB?: unknown }).indexedDB = idb;
  setActiveLocalUser("u1");
  localStorage.setItem("px-local-first", "1"); // the laptop copy exists only with local-first on (package lf-fc, cost:COST-02)
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
    server.failNext({ status: 503, path: "/push", times: 10 });
  }
  current.outbox = { flush: async () => { order.push("outbox.flush"); return outbox.flush(); } };
  // The durable identity the boot mirrored, in both copies, plus the Supabase session's own browser storage.
  await getIdentityStore().write(IDENTITY);
  localStorage.setItem("sb-abc-auth-token", "{}");
  return { server };
}

async function personDbs() {
  return (await idb.databases()).map((d) => d.name).filter((n) => n?.startsWith("projexa-local:"));
}
async function metaIdentity() {
  const { meta, close } = await openDeviceMeta(idb);
  try { return (await meta.getMeta(META_KEYS.identity)) ?? null; } finally { close(); }
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  order.length = 0;
  push.mockClear();
  toastMessage.mockClear();
  clearPerson.mockClear();
  supabaseMode.reachable = true;
  forgetLastSignOutNotice();
  resetDeliberateSignOutForTests();
  localStorage.clear();
  globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setActiveLocalUser(null);
  current.outbox = null;
});

async function clickSignOut(view: ReturnType<typeof render>, name: RegExp | string = /Sign Out/) {
  const buttons = [...view.queryAllByRole("button", { name }), ...view.queryAllByRole("menuitem", { name })];
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
}

for (const path of PATHS) {
  describe(`${path.name}'s Sign out goes through signOutEverywhere`, () => {
    test("workspace step first, then the identity is cleared (both copies), the worker drops the person's caches, Supabase is told", async () => {
      await laptop(false);
      expect(await metaIdentity()).not.toBeNull();
      await clickSignOut(path.mount());
      expect(order.filter((o) => !o.startsWith("outbox.flush"))).toEqual([
        "boq copy cleared", // the button's own step (kept)
        "workspace step done (identity present)",
        "sw.clearPerson u1 (identity gone)",
        "supabase.signOut (identity gone)",
        "push /login",
      ]);
      expect(localStorage.getItem(IDENTITY_STORAGE_KEY)).toBeNull();
      expect(await metaIdentity()).toBeNull();
      expect(clearPerson).toHaveBeenCalledTimes(1);
      // package lf-fc (cost:COST-05): the default Sign Out KEEPS this laptop's copy of the workspace
      expect(await personDbs()).toEqual(["projexa-local:u1"]);
      expect(localStorage.getItem("sb-abc-auth-token")).toBe("{}"); // reachable: Supabase's own signOut does this, not the hand clearing
      expect(toastMessage).not.toHaveBeenCalled();
    });

    test("'Sign out and delete this laptop's copy': the same order, and the workspace step deletes the copy before the identity goes", async () => {
      await laptop(false);
      await clickSignOut(path.mount(), SIGN_OUT_AND_DELETE_LABEL);
      expect(order.filter((o) => !o.startsWith("outbox.flush"))).toEqual([
        "boq copy cleared", // the button's own step
        "boq copy cleared", // the workspace step's, after it deleted the database
        "workspace step done (identity present)",
        "sw.clearPerson u1 (identity gone)",
        "supabase.signOut (identity gone)",
        "push /login",
      ]);
      expect(await personDbs()).toEqual([]);
      expect(localStorage.getItem(IDENTITY_STORAGE_KEY)).toBeNull();
      expect(toastMessage).not.toHaveBeenCalled();
    });

    test("Supabase cannot be reached: the session cookies/storage are cleared by hand and the identity is still gone", async () => {
      await laptop(false);
      supabaseMode.reachable = false;
      document.cookie = "sb-abc-auth-token=xyz; Path=/";
      await clickSignOut(path.mount());
      expect(localStorage.getItem("sb-abc-auth-token")).toBeNull();
      expect(document.cookie).not.toContain("sb-abc-auth-token=xyz");
      expect(localStorage.getItem(IDENTITY_STORAGE_KEY)).toBeNull();
      expect(clearPerson).toHaveBeenCalledTimes(1);
    });

    test("an edit still pending: the person's database is KEPT and the notice is shown, and the identity still ends", async () => {
      await laptop(true);
      await clickSignOut(path.mount());
      expect(await personDbs()).toEqual(["projexa-local:u1"]);
      const db = await openLocalDb(idb, localDbNameFor("u1"));
      expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-1"]);
      db.close();
      expect(toastMessage).toHaveBeenCalledTimes(1);
      expect(String(toastMessage.mock.calls[0]![0])).toContain("1 change you made on this laptop has not reached the server yet");
      expect(localStorage.getItem(IDENTITY_STORAGE_KEY)).toBeNull();
      expect(order.indexOf("push /login")).toBeGreaterThan(order.findIndex((o) => o.startsWith("toast ")));
    });
  });
}
