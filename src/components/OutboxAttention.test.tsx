/// <reference types="bun-types" />
// LOCAL-FIRST: the card that tells a person when a change made on this laptop needs them -- a refusal (in words), a
// conflict (both sides, two choices), a change that needs the online screen, and "offline / signed out / update PROJEXA".
// Driven against a REAL outbox over the shared fake sync server.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { LOCAL_FIRST_FLAG } from "@/lib/local-first/local-reader";
import { createOutbox, type Outbox } from "@/lib/local-first/outbox";
import { OUTBOX_NOTICES_KEY, localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { createReplica } from "@/lib/local-first/replica";
import { OutboxAttention, differences } from "./OutboxAttention";

afterEach(() => {
  cleanup();
  localStorage.removeItem(LOCAL_FIRST_FLAG);
});

async function rig(): Promise<{ idb: IDBFactory; server: FakeSyncServer; outbox: Outbox }> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer();
  server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", statusId: "s1", completionPercentage: 10 } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let n = 0;
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "d", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  return { idb, server, outbox };
}

const editTask = (o: Outbox, patch: Record<string, unknown>) =>
  o.enqueue({
    functionId: "update_task", projectId: "p1", params: { issueId: "t1", ...patch }, label: "Your change to this task",
    record: { kind: "tasks", id: "t1", baseVersion: 1 },
    optimistic: async (tx) => {
      const row = (await tx.getRecord("tasks", "t1"))!;
      await tx.patchRecord("tasks", "t1", { data: { ...(row.data as object), ...patch } });
    },
  });

describe("OutboxAttention", () => {
  test("renders nothing when nothing needs the person (and with the flag off it does not even look)", async () => {
    const r = await rig();
    let loaded = false;
    const watched: Outbox = { ...r.outbox, refresh: async () => { const state = await r.outbox.refresh(); loaded = true; return state; } };
    const quiet = render(<OutboxAttention outbox={watched} />);
    await waitFor(() => expect(loaded).toBe(true)); // the card has read the outbox's state...
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(quiet.container.innerHTML).toBe(""); // ...and has nothing to say
    cleanup();
    const off = render(<OutboxAttention />); // no outbox injected, flag not "1"
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(off.container.innerHTML).toBe("");
  });

  test("a change the server turned down is explained in words (its draft card says it)", async () => {
    const r = await rig();
    await editTask(r.outbox, { title: " " }); // the server refuses an empty title
    await r.outbox.flush();
    const view = render(<OutboxAttention outbox={r.outbox} />);
    const card = await view.findByTestId("outbox-draft");
    expect(card.textContent).toContain("Your change to this task was not saved. Type a title. It was undone on this laptop.");
  });

  test("a notice with no draft (kept by an older version of the app) still shows and can be dismissed", async () => {
    const r = await rig();
    const db = await openLocalDb(r.idb, localDbNameFor("u1"));
    await db.setMeta(OUTBOX_NOTICES_KEY, [{ opId: "old", functionId: "update_task", message: "An older change was not saved.", at: 1 }]);
    db.close();
    const view = render(<OutboxAttention outbox={r.outbox} />);
    const notice = await view.findByTestId("outbox-notice");
    expect(notice.textContent).toContain("An older change was not saved.");
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
    expect(r.outbox.getState().notices).toEqual([]);
  });

  describe("a conflict", () => {
    async function conflicted() {
      const r = await rig();
      await editTask(r.outbox, { title: "Mine", completionPercentage: 80 });
      r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs", statusId: "s1", completionPercentage: 10 } });
      await r.outbox.flush();
      return r;
    }

    test("shows what each side wrote, in words, with Keep theirs / Keep mine", async () => {
      const r = await conflicted();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      const row = await view.findByTestId("outbox-conflict");
      expect(row.textContent).toContain("Your change to this task: someone else changed the same thing while you were working.");
      expect(row.textContent).toContain("Title: you wrote Mine, they wrote Theirs");
      // R12: only the field BOTH sides changed is the person's to decide; my % complete (they did not touch it) is not asked about.
      expect(row.textContent).not.toContain("Completion percentage");
      expect(row.textContent).not.toMatch(/statusId|issueId|completionPercentage/); // no parameter names
      expect(view.getByRole("button", { name: "Keep theirs" })).toBeTruthy();
      expect(view.getByRole("button", { name: "Keep mine" })).toBeTruthy();
    });

    test("Keep mine sends the change over theirs; the card goes when it is applied", async () => {
      const r = await conflicted();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      await view.findByTestId("outbox-conflict");
      fireEvent.click(view.getByRole("button", { name: "Keep mine" }));
      await waitFor(() => expect(r.outbox.getState().conflicts).toHaveLength(0));
      await act(async () => { await r.outbox.flush(); });
      await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
      expect(r.server.getRow("tasks", "t1")).toMatchObject({ data: { title: "Mine", completionPercentage: 80 } });
    });

    test("Keep theirs takes their title; my OTHER change (only I made it) still goes; the card goes", async () => {
      const r = await conflicted();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      await view.findByTestId("outbox-conflict");
      fireEvent.click(view.getByRole("button", { name: "Keep theirs" }));
      await waitFor(() => expect(r.outbox.getState().conflicts).toHaveLength(0));
      await act(async () => { await r.outbox.flush(); });
      await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
      expect(await r.outbox.pendingCount()).toBe(0);
      expect(r.server.getRow("tasks", "t1")!.data).toMatchObject({ title: "Theirs", completionPercentage: 80 });
    });

    test("Keep theirs when theirs and mine differ on EVERY field I changed drops my change entirely", async () => {
      const r = await rig();
      await editTask(r.outbox, { title: "Mine" });
      r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs", statusId: "s1", completionPercentage: 10 } });
      await r.outbox.flush();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      await view.findByTestId("outbox-conflict");
      fireEvent.click(view.getByRole("button", { name: "Keep theirs" }));
      await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
      expect(await r.outbox.pendingCount()).toBe(0);
      expect(r.server.getRow("tasks", "t1")!.data.title).toBe("Theirs");
    });
  });

  test("a change that needs the online screen can be stopped, and what was typed is kept as a draft", async () => {
    const r = await rig();
    r.server.registerFunction("edge_only", () => ({ needsServer: true }));
    await r.outbox.enqueue({ functionId: "edge_only", projectId: "p1", params: { note: "my words" }, label: "Heavy report" });
    await r.outbox.flush();
    const view = render(<OutboxAttention outbox={r.outbox} />);
    const row = await view.findByTestId("outbox-blocked");
    expect(row.textContent).toContain("Heavy report needs the online screen");
    fireEvent.click(view.getByRole("button", { name: "Keep my text and stop" }));
    await waitFor(() => expect(view.queryByTestId("outbox-blocked") === null).toBe(true));
    expect(await r.outbox.pendingCount()).toBe(0);
    const draft = await view.findByTestId("outbox-draft");
    expect(draft.textContent).toContain("my words"); // no screen edits this function: the text itself is shown
  });

  describe("(FB data:F4) one card per change that was not saved: Edit again / Discard", () => {
    test("a refused task edit shows ONE card (not a notice and a card), with Edit again pointing at the task form and its draft", async () => {
      const r = await rig();
      await editTask(r.outbox, { title: " ", description: "typed words" });
      await r.outbox.flush();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      const card = await view.findByTestId("outbox-draft");
      expect(card.textContent).toContain("Your change to this task was not saved. Type a title.");
      expect(card.textContent).toContain("What you typed is kept on this laptop");
      expect(view.queryAllByTestId("outbox-notice")).toHaveLength(0);
      const link = view.getByRole("link", { name: "Edit again" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/schedule/tasks/t1?draft=op-1");
    });

    test("Discard removes the draft (and its notice) for good", async () => {
      const r = await rig();
      await editTask(r.outbox, { title: " " });
      await r.outbox.flush();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      await view.findByTestId("outbox-draft");
      fireEvent.click(view.getByRole("button", { name: "Discard" }));
      await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
      const state = await r.outbox.refresh();
      expect(state.drafts).toEqual([]);
      expect(state.notices).toEqual([]);
    });
  });

  describe("(FB data:F6) deleted by someone else", () => {
    async function deleted(seedStart = true) {
      const r = await rig();
      if (!seedStart) r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", statusId: "s1", completionPercentage: 10 } });
      await editTask(r.outbox, { title: "Mine" });
      const client = r.server.client;
      const push = client.push;
      client.push = async (req) => ({ results: req.ops.map((o) => ({ op_id: o.op_id, status: "conflict" as const })) });
      await r.outbox.flush();
      client.push = push;
      return r;
    }

    test("says so plainly, offers Keep my text (no create can carry it here) and Discard; Keep my text leaves a draft card", async () => {
      const r = await deleted();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      const card = await view.findByTestId("outbox-deleted");
      expect(card.textContent).toContain("Your change to this task: this was deleted by someone else");
      fireEvent.click(view.getByRole("button", { name: "Keep my text" }));
      const draft = await view.findByTestId("outbox-draft");
      expect(draft.textContent).toContain("deleted by someone else");
      expect(await r.outbox.pendingCount()).toBe(0);
    });

    test("Discard drops it and nothing is left to say", async () => {
      const r = await deleted();
      const view = render(<OutboxAttention outbox={r.outbox} />);
      await view.findByTestId("outbox-deleted");
      fireEvent.click(view.getByRole("button", { name: "Discard" }));
      await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
    });
  });

  describe("(FB data:F7) an outcome the server could not confirm", () => {
    test("is shown as checking, then as needing the person with Send again / Stop and keep my text", async () => {
      const r = await rig();
      const clock = { now: 1_800_000_000_000 };
      const client = { ...r.server.client, push: async (req: { ops: { op_id: string }[] }) => ({ results: req.ops.map((o) => ({ op_id: o.op_id, status: "failed" as const, error: { code: "EXECUTION_UNCERTAIN" } })) }) };
      const outbox = createOutbox({ userId: "u1", client, deviceId: "d", idb: r.idb, autoFlush: false, locks: null, sleep: async () => {}, now: () => clock.now, newOpId: () => "op-1" });
      await editTask(outbox, { title: "Unsure" });
      await outbox.flush();
      const view = render(<OutboxAttention outbox={outbox} />);
      const checking = await view.findByTestId("outbox-checking");
      expect(checking.textContent).toBe("Checking whether your change to this task reached the server (1 of 5).");
      for (let i = 0; i < 4; i += 1) await act(async () => { clock.now += 10 * 60_000; await outbox.flush(); });
      const card = await view.findByTestId("outbox-needs-you");
      expect(card.textContent).toContain("could not confirm whether it was saved");
      fireEvent.click(view.getByRole("button", { name: "Stop and keep my text" }));
      await view.findByTestId("outbox-draft");
      expect(await outbox.pendingCount()).toBe(0);
    });
  });

  test("(FB wire:F14) a sign-in the server no longer links: one sentence, nothing lost, and Try again", async () => {
    const r = await rig();
    await editTask(r.outbox, { title: "Waiting" });
    r.server.failNext({ status: 403, path: "/push", times: 1 });
    const view = render(<OutboxAttention outbox={r.outbox} />);
    await act(async () => { await r.outbox.flush(); });
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("no longer recognises your sign-in"));
    expect(view.getByRole("status").textContent).toContain("Nothing is lost");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await act(async () => { await r.outbox.flush(); });
    await waitFor(() => expect(view.queryByTestId("outbox-attention") === null).toBe(true));
  });

  describe("says what is happening, and that nothing is lost", () => {
    async function waiting(cause: (r: Awaited<ReturnType<typeof rig>>) => void) {
      const r = await rig();
      await editTask(r.outbox, { title: "Waiting" });
      const view = render(<OutboxAttention outbox={r.outbox} />);
      cause(r);
      await act(async () => { await r.outbox.flush(); });
      return view;
    }

    test("offline", async () => {
      const view = await waiting((r) => r.server.failNext({ status: 503, path: "/push", times: 5 }));
      await waitFor(() => expect(view.getByRole("status").textContent).toBe("Offline: 1 change is saved on this laptop and will be sent when the connection returns."));
    });

    test("signed out", async () => {
      const view = await waiting((r) => { r.server.signedOut = true; });
      await waitFor(() => expect(view.getByRole("status").textContent).toBe("You are signed out. Sign in again to send 1 change made on this laptop."));
    });

    test("this release is too old for the service", async () => {
      const view = await waiting((r) => r.server.requireUpdate({ current: "9", minCompatible: "8" }));
      await waitFor(() => expect(view.getByRole("status").textContent).toBe("PROJEXA on this laptop must be updated before your changes can be sent. Nothing is lost."));
    });
  });
});

describe("differences()", () => {
  test("lists the scalar fields that differ, in words, never an id or a timestamp, at most four", () => {
    const mine = { id: "t1", projectId: "p", title: "Mine", statusId: "s2", dueDate: null, updated_at: "x", completionPercentage: 80, a1: 1, b2: 2, c3: 3, d4: 4, nested: { x: 1 }, number: 7 };
    const theirs = { id: "t1", projectId: "p", title: "Theirs", statusId: "s1", dueDate: "2026-10-05", updated_at: "y", completionPercentage: 10, a1: 9, b2: 9, c3: 9, d4: 9, nested: { x: 2 }, number: 8 };
    const out = differences(mine, theirs);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ label: "Title", mine: "Mine", theirs: "Theirs" });
    expect(out.map((d) => d.label)).not.toContain("Status id");
    expect(differences({ a: "x" }, { a: "x" })).toEqual([]);
    expect(differences({ dueDate: null }, { dueDate: "2026-10-05" })).toEqual([{ label: "Due date", mine: "empty", theirs: "2026-10-05" }]);
    expect(differences(null, {})).toEqual([]);
  });
});

describe("where it is mounted", () => {
  test("the app layout mounts it once, so every screen under (app) has it", () => {
    const layout = readFileSync(join(import.meta.dir, "..", "app", "(app)", "layout.tsx"), "utf8");
    expect(layout).toContain('import { OutboxAttention } from "@/components/OutboxAttention";');
    expect(layout.match(/<OutboxAttention \/>/g)).toHaveLength(1);
  });
});
