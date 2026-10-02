import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, doneKey } from "../replica";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";
import { releaseSharedOutbox } from "../outbox-shared";
import LocalShell from "./LocalShell";

// lf-e10b, found in a real Chromium (e2e/lf-documents-docs.spec.ts): when the server turned down an edit made on a shell screen (its
// text kept as a DRAFT) or answered it with a CONFLICT, the person was told NOWHERE while they worked on the laptop's screens: the one
// component that says so (OutboxAttention) was mounted only in the online app's layout and on the local dashboard. Every shell screen
// must show it, once.

const NOW = 1_760_000_000_000;
let idb: IDBFactory;

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "member", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

const TYPED = "Zone C pour postponed; awaiting the consultant's sign-off.";

beforeEach(async () => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["meeting_minutes"], at: 1 });
  await db.setMeta(doneKey("p1", "meeting_minutes"), { at: NOW, redacted: false, hiddenFields: [] });
  // what the outbox stores when the server turns an amendment down: the person's text, kept as a draft
  await db.transact((tx) => tx.putDraft({
    opId: "op-refused-1", functionId: "update_mom_minutes", projectId: "p1", params: { projectId: "p1", meetingId: "m1", minutes: TYPED },
    record: { kind: "meeting_minutes", id: "m1" }, label: "Your amendment to these minutes", message: "Your amendment to these minutes was not saved: your role cannot change minutes.",
    code: "NOT_PERMITTED", at: NOW,
  }));
  db.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
});
afterEach(() => {
  cleanup();
  releaseSharedOutbox("u1");
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

test("a change the server turned down is shown on an ordinary shell screen (not only the dashboard), with the text the person typed", async () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://px.test/local/moms?projectId=p1");
  const { findByTestId, findAllByTestId } = render(<LocalShell />);
  await findByTestId("moms-list");
  const cards = await findAllByTestId("outbox-draft", {}, { timeout: 3000 });
  expect(cards).toHaveLength(1);
  expect((await findByTestId("outbox-draft-text")).textContent).toContain(TYPED);
});

test("on the local dashboard the card is shown ONCE (the shell's, not a second copy from the screen)", async () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://px.test/local/dashboard?projectId=p1");
  const { findAllByTestId } = render(<LocalShell />);
  await findAllByTestId("outbox-draft", {}, { timeout: 3000 });
  await new Promise((r) => setTimeout(r, 300));
  expect(document.querySelectorAll('[data-testid="outbox-attention"]')).toHaveLength(1);
});
