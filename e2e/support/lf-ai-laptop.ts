// LOCAL-FIRST browser AI e2e (package lf-e11): getting a laptop ready the way a person does, and talking to window.projexa.ai the way an
// OUTSIDE AI does -- only through page.evaluate against window.projexa.ai, never a private import. Used by e2e/lf-ai-*.spec.ts.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, type LocalSession } from "./boq-local";
import { PEOPLE, signIn, stubAppApis, stubSync, type Net, type Person, type PersonKey, type SyncStub } from "./lf-ai-stub";

/** `current`: who the page's /api calls are answered for -- switch it when another person signs in on this laptop. */
export type Laptop = { page: Page; context: BrowserContext; net: Net; sync: SyncStub; people: Map<string, Person>; session: LocalSession; person: Person; apiRequests: string[]; current: { person: Person; session: LocalSession } };

/** What an AI gets back from a call: the value, or the refusal's code and plain-words message. */
export type AiOutcome<T = unknown> = { ok: true; value: T } | { ok: false; code: string | null; message: string; name: string };

function readMeta(page: Page, dbName: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return; }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key);
          get.onerror = () => { db.close(); resolve(undefined); };
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value); };
        };
      }),
    { dbName, key }
  );
}
export const deviceMeta = (page: Page, key: string) => readMeta(page, "projexa-local", key);
export const personMeta = (page: Page, userId: string, key: string) => readMeta(page, `projexa-local:${userId}`, key);

/** Waits until window.projexa.ai is published (AiAttach on every signed-in page). */
export async function waitForAi(page: Page, message = "window.projexa.ai never appeared") {
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { projexa?: { ai?: unknown } }).projexa?.ai === "object"), { timeout: 60_000, message }).toBe(true);
}

/** Calls window.projexa.ai.<method>(...args) exactly as an outside AI would, and returns the value or the refusal. */
export function ai<T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<AiOutcome<T>> {
  return page.evaluate(
    async ({ method, args }) => {
      const api = (window as unknown as { projexa?: { ai?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).projexa?.ai;
      if (!api) return { ok: false as const, code: "NO_SURFACE", message: "window.projexa.ai is absent", name: "Missing" };
      try {
        return { ok: true as const, value: (await api[method](...args)) as never };
      } catch (err) {
        const e = err as { code?: string; message?: string; name?: string };
        return { ok: false as const, code: e?.code ?? null, message: String(e?.message ?? err), name: String(e?.name ?? "") };
      }
    },
    { method, args }
  ) as Promise<AiOutcome<T>>;
}

/** The value of a call that must succeed (fails the test with the refusal's words otherwise). */
export async function aiValue<T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  const out = await ai<T>(page, method, ...args);
  if (!out.ok) throw new Error(`window.projexa.ai.${method} refused: ${out.code} ${out.message}`);
  return out.value;
}

/**
 * A person signs in on this laptop for the first time, online: the "Preparing your workspace" screen copies their projects, the release
 * is installed, and the AI surface is published with their identity from the sync service's /manifest.
 */
export async function prepareLaptop(page: Page, context: BrowserContext, key: PersonKey, opts: { net?: Net; people?: Map<string, Person>; sync?: SyncStub; person?: Partial<Person> } = {}): Promise<Laptop> {
  const net = opts.net ?? { mode: "up" };
  const people = opts.people ?? new Map<string, Person>();
  const person: Person = { ...PEOPLE[key], ...opts.person };
  const session = await signIn(context, people, person);
  const current = { person, session };
  const sync = opts.sync ?? (await stubSync(context, people, net));
  const apiRequests = await stubAppApis(context, APP_ORIGIN, () => current, net);

  await test.step(`online: ${person.role} ${person.name} opens PROJEXA for the first time; the workspace is prepared`, async () => {
    await page.goto(`/schedule?projectId=${person.projects[0].id}`);
    await expect(page.getByTestId("prepare-percent"), "the 'Preparing your workspace' screen never reached 100%").toHaveText("100%", { timeout: 240_000 });
    await page.getByTestId("prepare-continue").click();
    await expect
      .poll(() => personMeta(page, session.userId, `sync:done:${person.projects[0].id}:tasks`), { timeout: 120_000, message: "the tasks were never copied to the laptop" })
      .toBeTruthy();
  });
  return { page, context, net, sync, people, session, person, apiRequests, current };
}

/** The person's identity the AI surface keeps on the laptop (ai:identity), so a test can wait for the /manifest refresh to land. */
export async function waitForAiIdentity(laptop: Laptop) {
  await expect
    .poll(() => personMeta(laptop.page, laptop.session.userId, "ai:identity"), { timeout: 60_000, message: "the AI never learned the person's role (ai:identity)" })
    .toMatchObject({ userId: laptop.session.userId, role: laptop.person.role, orgId: laptop.person.orgId });
}

export async function goOffline(laptop: Laptop) {
  laptop.net.mode = "offline";
  await laptop.context.setOffline(true);
}

export async function goOnline(laptop: Laptop) {
  laptop.net.mode = "up";
  await laptop.context.setOffline(false);
}
