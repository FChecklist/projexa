import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { createOutbox } from "./outbox";
import { createReplica } from "./replica";
import { SyncError, type SyncClient } from "./sync-client";

// lf-e11, found by the first real-browser run of the browser AI: a write made with the network OFF tries to go after every change and on
// a timer; each try fails for want of a network and doubles the op's backoff (2 s, 4 s, ... up to 5 minutes). When the connection came
// back, the browser's `online` event called flush(), which still skipped every op that was not "due" -- so what the person (or their AI)
// did offline waited up to five minutes after the laptop was online again. flush({connectivityBack: true}) (what outbox-shared.ts's
// `online` handler now calls) makes ops that only failed for want of a network due at once; a failure the SERVER answered keeps its
// backoff (it must not be hammered).

async function rig() {
  const idb = new IDBFactory();
  const server = createFakeSyncServer();
  server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  const net = { mode: "offline" as "offline" | "up" | "server_error" };
  const tries = { n: 0 };
  const client: Pick<SyncClient, "push" | "pullIds"> = {
    pullIds: server.client.pullIds,
    push: async (req, signal) => {
      tries.n += 1;
      if (net.mode === "offline") throw new SyncError("network", "Failed to fetch");
      if (net.mode === "server_error") throw new SyncError("server", "503", 503);
      return server.client.push(req, signal);
    },
  };
  const clock = { now: 1_800_000_000_000 };
  let n = 0;
  const outbox = createOutbox({ userId: "u1", client, deviceId: "dev-1", idb, now: () => clock.now, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null });
  const pushes = () => server.requests.filter((r) => r.path === "/push").length;
  return { outbox, net, clock, pushes, tries };
}

const create = (o: Awaited<ReturnType<typeof rig>>["outbox"]) =>
  o.enqueue({ functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "Offline", question: "q?" }, label: "New RFI" });

test("offline tries build up a backoff; when the browser is back online the op goes at once", async () => {
  const r = await rig();
  await create(r.outbox);
  for (let i = 0; i < 6; i += 1) { await r.outbox.flush(); r.clock.now += 500; } // six offline tries: the backoff is now a minute
  expect(r.pushes()).toBe(0);

  r.net.mode = "up";
  // an ordinary flush respects the backoff (nothing is due yet) ...
  expect((await r.outbox.flush()).sent).toBe(0);
  // ... the browser's `online` event does not wait for it
  const report = await r.outbox.flush({ connectivityBack: true });
  expect(report.applied).toBe(1);
  expect(r.pushes()).toBe(1);
  expect(await r.outbox.pendingCount()).toBe(0);
});

test("a failure the server answered keeps its backoff even when the browser says it is back online", async () => {
  const r = await rig();
  r.net.mode = "server_error";
  await create(r.outbox);
  await r.outbox.flush();
  expect(r.tries.n).toBe(1);
  await r.outbox.flush({ connectivityBack: true });
  expect(r.tries.n, "a server-answered failure was retried before its backoff").toBe(1);
  expect(await r.outbox.pendingCount()).toBe(1);
});
