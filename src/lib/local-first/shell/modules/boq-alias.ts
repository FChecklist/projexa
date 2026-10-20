// LOCAL-FIRST shell: what a BOQ made on this laptop became on the server (R-19).
//
// A BOQ saved here gets a temporary id (`local-...`) and the screen opens it by that id. When the outbox is online the server accepts it in a
// second or two, the temporary row is replaced by the real one, and the real BOQ has a DIFFERENT id: the screen the person is looking at
// would then say "This BOQ is not in the copy on this laptop". The shell remembers temporary id -> server id here (in the person's own
// database, so it survives a reload) and the BOQ screen follows it to the real BOQ.

import { localDbNameFor, openLocalDb } from "../../local-db";
import type { ShellData } from "../context";

const ALIASES_KEY = "shell:boq-aliases";
const KEEP = 200;

type Access = Pick<ShellData, "userId" | "idb">;

async function withMeta<T>(data: Access, fn: (db: Awaited<ReturnType<typeof openLocalDb>>) => Promise<T>): Promise<T | null> {
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return null;
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export async function rememberBoqAlias(data: Access, tempId: string, serverId: string): Promise<void> {
  if (!tempId.startsWith("local-") || !serverId) return;
  await withMeta(data, async (db) => {
    const seen = (await db.getMeta<Record<string, string>>(ALIASES_KEY)) ?? {};
    await db.setMeta(ALIASES_KEY, Object.fromEntries(Object.entries({ ...seen, [tempId]: serverId }).slice(-KEEP)));
  });
}

/** The server's id for a temporary BOQ id, or null when the server has not accepted it (or the laptop never heard). */
export async function lookupBoqAlias(data: Access, tempId: string): Promise<string | null> {
  try {
    const found = await withMeta(data, async (db) => ((await db.getMeta<Record<string, string>>(ALIASES_KEY)) ?? {})[tempId] ?? null);
    return found ?? null;
  } catch {
    return null;
  }
}
