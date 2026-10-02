import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "./local-db";
import { MANIFEST_KEY, doneKey, cursorKey } from "./replica";
import { loadLocalFirst, readLocal, useLocalFirst, type UseLocalFirstOptions, type UseLocalFirstValue } from "./local-reader";

type Line = { id: string; description: string; n: number };

async function seed(idb: IDBFactory, opts: { userId?: string; orgId?: string; done?: boolean; lines?: Line[]; projectId?: string } = {}) {
  const userId = opts.userId ?? "u1";
  const orgId = opts.orgId ?? "orgA";
  const projectId = opts.projectId ?? "p1";
  const db = await openLocalDb(idb, localDbNameFor(userId));
  await db.setMeta(MANIFEST_KEY, { userId, orgId, projectIds: [projectId], kinds: ["boq_lines"], at: 1 });
  await db.putRecords((opts.lines ?? []).map((l) => ({ id: `boq_lines:${l.id}`, type: "boq_lines", orgId, projectId, data: l, updatedAt: 1 })));
  await db.setMeta(cursorKey(projectId, "boq_lines"), 5);
  if (opts.done !== false) await db.setMeta(doneKey(projectId, "boq_lines"), { at: 1_760_000_000_000, redacted: false, hiddenFields: [] });
  db.close();
}

const lines: Line[] = [
  { id: "a", description: "Brick work", n: 3 },
  { id: "b", description: "Plaster", n: 1 },
  { id: "c", description: "Paint", n: 2 },
];

afterEach(() => cleanup());

describe("readLocal / loadLocalFirst", () => {
  test("reads one project's rows with filter, sort and limit", async () => {
    const idb = new IDBFactory();
    await seed(idb, { lines });
    const sorted = await readLocal<Line>("boq_lines", { projectId: "p1", userId: "u1", idb, sort: (x, y) => x.n - y.n, limit: 2 });
    expect(sorted.map((l) => l.id)).toEqual(["b", "c"]);
    const filtered = await readLocal<Line>("boq_lines", { projectId: "p1", userId: "u1", idb, filter: (l) => l.description.startsWith("P") });
    expect(filtered.map((l) => l.id)).toEqual(["b", "c"]);
  });

  test("never returns rows of another organisation or of another project", async () => {
    const idb = new IDBFactory();
    await seed(idb, { lines });
    expect(await readLocal("boq_lines", { projectId: "p1", userId: "u1", idb, orgId: "orgB" })).toEqual([]);
    expect(await readLocal("boq_lines", { projectId: "other", userId: "u1", idb })).toEqual([]);
    expect(await readLocal("boq_lines", { projectId: "p1", userId: "someone-else", idb })).toEqual([]);
  });

  test("synced: local rows and the fallback is never called", async () => {
    const idb = new IDBFactory();
    await seed(idb, { lines });
    let called = 0;
    const r = await loadLocalFirst<Line>("boq_lines", "p1", async () => { called += 1; return []; }, { userId: "u1", idb });
    expect(r.state).toBe("local");
    expect(r.rows.length).toBe(3);
    expect(r.syncedAt).toBe(1_760_000_000_000);
    expect(called).toBe(0);
  });

  test("not synced, or synced only half way: the fallback answers", async () => {
    const idb = new IDBFactory();
    await seed(idb, { lines, done: false }); // rows and a cursor exist but the copy never reached the end
    const fromServer: Line[] = [{ id: "s", description: "server", n: 9 }];
    const half = await loadLocalFirst<Line>("boq_lines", "p1", async () => fromServer, { userId: "u1", idb });
    expect(half).toMatchObject({ state: "server", rows: fromServer });
    const never = await loadLocalFirst<Line>("boq_lines", "p9", async () => fromServer, { userId: "u1", idb });
    expect(never.state).toBe("server");
  });
});

function Probe({ fetcher, options, onValue }: { fetcher: () => Promise<Line[]>; options: UseLocalFirstOptions<Line>; onValue: (v: UseLocalFirstValue<Line>) => void }) {
  const v = useLocalFirst<Line>("boq_lines", "p1", fetcher, options);
  onValue(v);
  return <div data-testid="state" data-state={v.state} data-rows={v.rows.map((r) => r.id).join(",")} data-refreshing={String(v.refreshing)} />;
}

describe("useLocalFirst", () => {
  test("synced: shows local rows without calling the fallback, and revalidates in the background", async () => {
    const idb = new IDBFactory();
    await seed(idb, { lines });
    let fallbackCalls = 0;
    let revalidated = 0;
    const { getByTestId } = render(
      <Probe
        fetcher={async () => { fallbackCalls += 1; return []; }}
        options={{ userId: "u1", idb, revalidate: async () => { revalidated += 1; } }}
        onValue={() => {}}
      />
    );
    await waitFor(() => expect(getByTestId("state").getAttribute("data-state")).toBe("local"));
    expect(getByTestId("state").getAttribute("data-rows")).toBe("a,b,c");
    await waitFor(() => expect(revalidated).toBe(1));
    await waitFor(() => expect(getByTestId("state").getAttribute("data-refreshing")).toBe("false"));
    expect(fallbackCalls).toBe(0);
  });

  test("not synced: shows the server's rows, then switches to local once the background sync completed the copy", async () => {
    const idb = new IDBFactory();
    let fallbackCalls = 0;
    const { getByTestId } = render(
      <Probe
        fetcher={async () => { fallbackCalls += 1; return [{ id: "s", description: "from server", n: 0 }]; }}
        options={{
          userId: "u1", idb,
          revalidate: async () => { await seed(idb, { lines }); }, // the replica finishing its first copy
        }}
        onValue={() => {}}
      />
    );
    await waitFor(() => expect(getByTestId("state").getAttribute("data-rows")).toBe("s"));
    await waitFor(() => expect(getByTestId("state").getAttribute("data-state")).toBe("local"));
    expect(getByTestId("state").getAttribute("data-rows")).toBe("a,b,c");
    expect(fallbackCalls).toBe(1);
  });

  test("a failing fallback becomes the error state, not an exception", async () => {
    const idb = new IDBFactory();
    const { getByTestId } = render(
      <Probe fetcher={async () => { throw new Error("server down"); }} options={{ userId: "u1", idb, background: false }} onValue={() => {}} />
    );
    await waitFor(() => expect(getByTestId("state").getAttribute("data-state")).toBe("error"));
  });
});
