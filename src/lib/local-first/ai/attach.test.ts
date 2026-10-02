// Auto-attach with zero setup: window.projexa.ai and the WebMCP tools appear as soon as the person is known; the
// identity is refreshed from the sync service when online and kept for offline; detach takes everything down.

import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../local-db";
import { createOutbox } from "../outbox";
import { createReplica } from "../replica";
import { IDENTITY_REFRESH_MS, attachAi } from "./attach";
import { AI_IDENTITY_KEY, type AiIdentity } from "./identity";
import type { WebMcpTool } from "./webmcp";
import { KINDS, seed } from "./__fixtures__/ai-rig";

async function boot(opts: { online?: boolean; role?: string; settings?: Record<string, unknown> } = {}) {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ projects: ["p1", "p2"], kinds: KINDS, role: opts.role ?? "manager" });
  seed(server);
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "d", idb, autoFlush: false, locks: null });
  const win: Record<string, unknown> & { dispatchEvent: (e: Event) => boolean } = { dispatchEvent: (e) => { events.push(e.type); return true; } };
  const events: string[] = [];
  const tools = new Map<string, WebMcpTool>();
  let manifestCalls = 0;
  const attached = await attachAi({
    userId: "u1", win, idb, outbox, now: () => 10 * IDENTITY_REFRESH_MS,
    nav: { onLine: opts.online !== false, modelContext: { registerTool: (t) => { tools.set(t.name, t); return { unregister: () => tools.delete(t.name) }; } } },
    fetchManifest: async () => {
      manifestCalls += 1;
      const m = await server.client.manifest();
      return opts.settings ? ({ ...m, settings: opts.settings } as typeof m) : m;
    },
  });
  return { idb, win, events, tools, attached, manifestCalls: () => manifestCalls };
}

const storedIdentity = async (idb: IDBFactory) => {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  try { return await db.getMeta<AiIdentity>(AI_IDENTITY_KEY); } finally { db.close(); }
};

describe("attachAi", () => {
  test("publishes window.projexa.ai, announces it, and registers the WebMCP tools", async () => {
    const { win, events, tools, attached } = await boot();
    const ai = (win.projexa as { ai: { manifest: () => Promise<{ person: { role: string } }> } }).ai;
    expect(ai).toBe(attached.surface.api);
    expect(events).toEqual(["projexa:ai-ready"]);
    expect(tools.size).toBe(8);
    expect((await ai.manifest()).person.role).toBe("manager");
  });

  test("online: the role and the setting come from the sync service and are stored for offline", async () => {
    const { idb, attached } = await boot({ settings: { ai_act_without_asking: true } });
    expect(attached.identityRefreshed).toBe(true);
    expect(await storedIdentity(idb)).toMatchObject({ userId: "u1", orgId: "orgA", role: "manager", settings: { aiActWithoutAsking: true } });
    expect((await attached.surface.api.manifest()).deletesNeedConfirmation).toBe(false);
  });

  test("offline: no call to the service at all; the surface still answers from the laptop", async () => {
    const { attached, manifestCalls } = await boot({ online: false });
    expect(manifestCalls()).toBe(0);
    expect(attached.identityRefreshed).toBe(false);
    expect((await attached.surface.api.list("tasks")).items.length).toBe(2);
  });

  test("detach takes window.projexa and the tools down", async () => {
    const { win, tools, attached } = await boot();
    attached.detach();
    expect(win.projexa).toBeUndefined();
    expect(tools.size).toBe(0);
  });
});
