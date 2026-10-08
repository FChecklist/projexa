import { expect, type BrowserContext, type Page } from "@playwright/test";
import { USERS, type UserKey } from "./../users";
import { signInByCode, realTestCode } from "./sign-in";

// AUDIT-100 (B7, B8, B13, B17, B18, B20, B28): shared helpers for the specs that run against the REAL backend (production build of PROJEXA on
// :3100 + the real projexa-sync service and the real PROJEXA Supabase project). Nothing here is stubbed. Accounts are the documented E2E test org
// (e2e/users.ts). The access token is read from the browser's own session cookie and is never printed.

export const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";
export const baseURL = `http://localhost:${process.env.AUDIT37_PORT ?? 3100}`;

export async function loginAndPrepare(page: Page, who: UserKey): Promise<void> {
  // this development laptop's link to Supabase drops now and then ("Failed to fetch" under the form): ask again, like a person would
  for (let attempt = 0; ; attempt++) {
    try {
      await signInByCode(page, USERS[who].email, { code: realTestCode, timeoutMs: 60_000 }); // (a "Failed to fetch" under the form leaves the page on /login)
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      await page.waitForTimeout(5_000);
    }
  }
  await expect.poll(async () => (await localDbNames(page)).length, { timeout: 300_000, message: "no projexa-local:<userId> database appeared" }).toBeGreaterThan(0);
  await expect
    .poll(() => countMeta(page, "sync:done:"), { timeout: 300_000, message: "no sync:done marker: the real data never reached the laptop" })
    .toBeGreaterThan(0);
}

export async function localDbNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")));
}

export async function countMeta(page: Page, prefix: string): Promise<number> {
  return page.evaluate(async (p) => {
    const [name] = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:"));
    if (!name) return -1;
    return new Promise<number>((resolve) => {
      const open = indexedDB.open(name);
      open.onerror = () => resolve(-1);
      open.onsuccess = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains("meta")) { d.close(); resolve(-1); return; }
        const g = d.transaction("meta", "readonly").objectStore("meta").getAllKeys();
        g.onsuccess = () => { d.close(); resolve((g.result as string[]).filter((k) => String(k).startsWith(p)).length); };
        g.onerror = () => { d.close(); resolve(-1); };
      };
    });
  }, prefix);
}

/** The person's access token, from the session cookie the sign-in set. Only ever used as an Authorization header; never logged. */
export async function accessToken(context: BrowserContext): Promise<string> {
  const cookies = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  let raw = cookies.map((c) => c.value).join("");
  raw = decodeURIComponent(raw);
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
  const parsed = JSON.parse(raw) as { access_token?: string } | [string];
  const token = Array.isArray(parsed) ? parsed[0] : parsed.access_token;
  if (!token) throw new Error("no access token in the session cookie");
  return token;
}

/** One real call to the real sync service as this person (reads the SERVER, not the laptop's copy). */
export async function serverCall<T = any>(context: BrowserContext, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const token = await accessToken(context);
  let res: Response | undefined;
  // a flaky link (connect timeouts, resets) must not fail a row: only a transport error is retried, never an answer from the service
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${SYNC_BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-px-client": "audit100-e2e; protocol=2; schema=3" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`projexa-sync ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

type Row = { id: string; version?: number; data: any; deleted?: boolean };

/** Opens a fresh browser profile = one more laptop, signs the given person in and waits for the first copy of their data. */
export async function openLaptop(browser: import("@playwright/test").Browser, who: UserKey): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL });
  const page = await context.newPage();
  await loginAndPrepare(page, who);
  // a person who works in the offline shell: its tab runs the auto-sync (the leader lock). The server screens (/dashboard...) do not sync by themselves.
  await page.goto("/local/");
  await expect
    .poll(async () => (await page.evaluate(async () => (await navigator.locks.query()).held?.map((l) => l.name) ?? [])).some((n) => n?.startsWith("px-peer-leader:")), {
      timeout: 120_000, message: "the offline shell is not running auto-sync",
    })
    .toBe(true);
  return { context, page };
}

/** Reads one object store of the laptop's own IndexedDB copy (all rows). */
export async function readStore(page: Page, store: "records" | "outbox" | "meta"): Promise<any[]> {
  return page.evaluate(async (s) => {
    const [name] = (await indexedDB.databases()).map((d) => d.name ?? "").filter((x) => x.startsWith("projexa-local:"));
    if (!name) return [];
    return new Promise<any[]>((resolve) => {
      const open = indexedDB.open(name);
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains(s)) { d.close(); resolve([]); return; }
        const all = d.transaction(s, "readonly").objectStore(s).getAll();
        all.onerror = () => { d.close(); resolve([]); };
        all.onsuccess = () => { d.close(); resolve(all.result as any[]); };
      };
    });
  }, store);
}

/** Rows of one kind the laptop holds in its own copy, matched on a piece of their data. `dirty` = a local edit still waiting to be sent. */
export async function localRows(page: Page, type: string, needle: string): Promise<Array<{ id: string; version: number | null; dirty: boolean; data: any }>> {
  return (await readStore(page, "records"))
    .filter((r) => r.type === type && JSON.stringify(r.data ?? "").includes(needle))
    .map((r) => ({ id: r.id, version: r.serverVersion ?? null, dirty: r.dirty !== undefined, data: r.data }));
}

export async function outboxOps(page: Page): Promise<Array<{ opId: string; functionId: string; status: string }>> {
  return (await readStore(page, "outbox")).map((o) => ({ opId: o.opId, functionId: o.functionId, status: o.status }));
}

/** Reads the SERVER's rows of one kind in one project (all pages) and returns those whose data contains the needle. */
export async function serverRows(context: BrowserContext, projectId: string, kind: string, needle: string): Promise<Row[]> {
  const found: Row[] = [];
  let after: string | null = null;
  for (let i = 0; i < 40; i++) {
    const res: any = await serverCall(context, "POST", "/pull", { project_id: projectId, kind, after, limit: 500 });
    for (const it of res.items as Row[]) if (JSON.stringify(it.data ?? "").includes(needle)) found.push(it);
    if (!res.has_more || !res.next_cursor) break;
    after = res.next_cursor;
  }
  return found;
}

/**
 * The project the specs write in: the FIRST active project of the person's manifest. The laptop copies projects in manifest order (about 30 requests
 * each at the service's 100/min pace), so the first one is ready after a minute or two while the last one takes ~6 minutes.
 */
export async function projectId(context: BrowserContext): Promise<string> {
  const m = await serverCall<{ projects: { id: string; name?: string; status?: string }[] }>(context, "GET", "/manifest");
  const p = m.projects.find((x) => x.status === "active");
  if (!p) throw new Error("this person's manifest has no active project");
  return p.id;
}

/** Opens a screen of the offline shell and waits until the laptop has this project's data (the first copy takes a few minutes: "not_synced" until then). */
export async function openLocal(page: Page, path: string, testId: string): Promise<void> {
  const deadline = Date.now() + 600_000;
  for (;;) {
    await page.goto(path);
    const state = await page.getByTestId(testId).getAttribute("data-state", { timeout: 30_000 }).catch(() => null);
    if (state === "local") return;
    if (Date.now() > deadline) throw new Error(`${path}: the screen never reached data-state=local (last: ${state})`);
    await page.waitForTimeout(10_000);
  }
}
