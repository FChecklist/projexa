import { test, expect, type Page } from "@playwright/test";
import { signInByCode, stubAuthOtp } from "./support/sign-in";
import { isDeniedName } from "../src/lib/local-first/ai/immutability";
import { STUB_PORT, type LocalSession } from "./support/boq-local";
import { ai, aiValue, deviceMeta, personMeta, prepareLaptop, stayOnServerPage, waitForAi, waitForAiIdentity } from "./support/lf-ai-laptop";
import { ORG_B, P1, PEOPLE, Q1, stubSync, type Person } from "./support/lf-ai-stub";

// LOCAL-FIRST browser AI (package lf-e11): R5 -- an AI can NEVER change the software -- tried the way an attacking script in the page
// would; the release check that switches the AI OFF when the installed files are missing or altered, and back ON once they are put back;
// and two people on one laptop: after a sign-out and another person's sign-in, the AI sees only the new person's database.
//
// Runs through playwright.local-first.config.ts; see e2e/lf-ai-discovery.spec.ts for the arrangement.

type AiRecord = { kind: string; id: string; data: Record<string, unknown> };

const releaseCaches = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("px-release-")));

/** Waits until the release is installed and verified by the AI surface (manifest().integrity === "ok"). */
async function releaseInstalled(page: Page) {
  await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 240_000, message: "the release was never installed (meta app:release)" }).toMatchObject({ version: expect.any(String) });
  await expect.poll(() => releaseCaches(page), { timeout: 60_000, message: "no px-release-<version> cache" }).toHaveLength(1);
}

test("R5: nothing on the AI surface can change code, configuration, the cache, the worker or the release; the obvious attacks fail", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "manager");
  await releaseInstalled(page);
  await page.reload();
  await waitForAi(page);
  await waitForAiIdentity(laptop);
  expect((await aiValue<{ integrity: string }>(page, "manifest")).integrity).toBe("ok");
  const before = { release: await deviceMeta(page, "app:release"), files: await deviceMeta(page, "app:files"), caches: await releaseCaches(page) };

  await test.step("every name the AI can reach (methods, WebMCP tools, every function of the manager's manual) is a DATA operation", async () => {
    const methods = await page.evaluate(() => Object.keys((window as unknown as { projexa: { ai: object } }).projexa.ai));
    const manual = await aiValue<{ tools: { name: string }[]; writes: { functions: Record<string, { id: string }[]> } }>(page, "manual");
    const names = [...methods, ...manual.tools.map((t) => t.name), ...Object.values(manual.writes.functions).flat().map((f) => f.id)];
    expect(names.length).toBeGreaterThan(60);
    expect(names.filter(isDeniedName)).toEqual([]);
  });

  await test.step("window.projexa cannot be overwritten, redefined or deleted; the API object cannot be changed", async () => {
    const result = await page.evaluate(() => {
      const w = window as unknown as { projexa: { ai: Record<string, unknown> } };
      const real = w.projexa.ai;
      const evil = { manifest: async () => ({ hacked: true }) };
      const tries: Record<string, string> = {};
      const attempt = (name: string, fn: () => unknown) => { try { fn(); tries[name] = "no error"; } catch (e) { tries[name] = (e as Error).name; } };
      attempt("assign window.projexa", () => { (window as unknown as { projexa: unknown }).projexa = { ai: evil }; });
      attempt("defineProperty window.projexa", () => Object.defineProperty(window, "projexa", { value: { ai: evil } }));
      attempt("delete window.projexa", () => { if (!delete (window as unknown as { projexa?: unknown }).projexa) throw new TypeError("not deleted"); });
      attempt("assign projexa.ai", () => { (w.projexa as { ai: unknown }).ai = evil; });
      attempt("assign a method", () => { real.manifest = evil.manifest; });
      attempt("add a method", () => { (real as Record<string, unknown>).runCode = () => 1; });
      attempt("defineProperty on the API", () => Object.defineProperty(real, "create", { value: () => 1 }));
      return { tries, same: w.projexa.ai === real, keys: Object.keys(w.projexa.ai).sort(), frozen: Object.isFrozen(real) };
    });
    expect(result.same, "window.projexa.ai was replaced").toBe(true);
    expect(result.frozen).toBe(true);
    expect(result.keys).toEqual(["create", "delete", "drafts", "get", "list", "manifest", "manual", "search", "update", "version"]);
    // each attempt either threw or silently did nothing (sloppy-mode assignment); none took effect (asserted above)
    expect(result.tries["defineProperty window.projexa"]).toBe("TypeError");
    expect(result.tries["defineProperty on the API"]).toBe("TypeError");
    expect((await aiValue<{ product: string }>(page, "manifest")).product).toBe("PROJEXA");
  });

  await test.step("prototype pollution does not turn a money delete into a direct one, nor widen the role", async () => {
    await page.evaluate(() => {
      const P = Object.prototype as Record<string, unknown>;
      P.aiActWithoutAsking = true; P.ai_act_without_asking = true; P.money_sensitive = false; P.min_role_rank = 0; P.role = "veridian_admin";
    });
    try {
      const res = await aiValue<{ status: string }>(page, "delete", "void_material_receipt", { kind: "material_receipts", id: "lf-ai-mr1" }, { projectId: P1.id, receiptId: "lf-ai-mr1", reason: "polluted" });
      expect(res.status).toBe("draft");
      const m = await aiValue<{ person: { role: string; roleRank: number }; settings: { aiActWithoutAsking: boolean } }>(page, "manifest");
      expect(m.person).toMatchObject({ role: "manager", roleRank: 3 });
      expect(m.settings.aiActWithoutAsking).toBe(false);
      // a parameter object that tries to smuggle a prototype is refused, not merged
      const smuggled = await page.evaluate(async (projectId) => {
        const params = JSON.parse(`{"projectId":"${projectId}","subject":"s","question":"q","__proto__":{"admin":true}}`);
        try { await (window as unknown as { projexa: { ai: { create(f: string, p: unknown): Promise<unknown> } } }).projexa.ai.create("create_rfi", params); return "accepted"; } catch (e) { return (e as { code: string }).code; }
      }, P1.id);
      expect(smuggled).toBe("UNKNOWN_PARAMS");
    } finally {
      await page.evaluate(() => { for (const k of ["aiActWithoutAsking", "ai_act_without_asking", "money_sensitive", "min_role_rank", "role"]) delete (Object.prototype as Record<string, unknown>)[k]; });
    }
  });

  await test.step("no function edits code, the worker, the release or the cache, and no record kind reaches the device's meta", async () => {
    for (const fn of ["deploy_release", "update_service_worker", "install_release", "write_file", "run_code", "eval", "update_config", "set_cache"]) {
      expect(await ai(page, "create", fn, { projectId: P1.id }), fn).toMatchObject({ ok: false, code: "UNKNOWN_FUNCTION" });
      expect(await ai(page, "update", fn, { kind: "meta", id: "app:release" }, { projectId: P1.id }), fn).toMatchObject({ ok: false, code: "UNKNOWN_FUNCTION" });
    }
    expect(await ai(page, "update", "update_task", { kind: "meta", id: "app:release" }, { projectId: P1.id, issueId: "app:release", title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await aiValue(page, "get", "meta", "app:release")).toBeNull();
    expect((await aiValue<{ items: unknown[] }>(page, "list", "meta")).items).toEqual([]);
    // the installed software is exactly what it was
    expect(await deviceMeta(page, "app:release")).toEqual(before.release);
    expect(await deviceMeta(page, "app:files")).toEqual(before.files);
    expect(await releaseCaches(page)).toEqual(before.caches);
    await page.reload();
    await waitForAi(page);
    expect((await aiValue<{ integrity: string }>(page, "manifest")).integrity).toBe("ok");
  });
});

test("R5 integrity: an altered or missing installed file switches the AI OFF and says why; with the release put back it is ON again", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "member");
  await releaseInstalled(page);
  await page.reload();
  await waitForAi(page);
  await waitForAiIdentity(laptop);
  expect((await aiValue<{ integrity: string }>(page, "manifest")).integrity).toBe("ok");
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // No release can be fetched while the files are broken (so nothing repairs them behind the test's back).
  const blockRelease = () => page.route("**/_release/**", (route) => route.abort("connectionrefused"));
  await blockRelease();

  const target = await test.step("one installed file is altered in Cache Storage", async () => {
    return page.evaluate(async () => {
      const open = indexedDB.open("projexa-local");
      const db: IDBDatabase = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
      const get = <T,>(key: string) => new Promise<T>((res) => { const r = db.transaction("meta").objectStore("meta").get(key); r.onsuccess = () => res((r.result as { value: T }).value); });
      const release = await get<{ version: string }>("app:release");
      const files = await get<{ rows: { path: string }[] }>("app:files");
      db.close();
      // A stylesheet when the release has one: altering the app's own script can stop the page booting (then window.projexa.ai never appears, which is not what this test checks).
      const row = files.rows.find((r) => r.path.endsWith(".css")) ?? files.rows.find((r) => r.path.endsWith(".js") && !r.path.includes("sw")) ?? files.rows[0];
      const url = row.path === "_shell/local.html" ? "/local" : `/${row.path}`;
      const cache = await caches.open(`px-release-${release.version}`);
      const original = await (await cache.match(url))!.arrayBuffer();
      await cache.put(url, new Response("/* changed by somebody */ window.evil = 1;", { headers: { "content-type": url.endsWith(".css") ? "text/css" : "application/javascript" } }));
      // in chunks: a spread of a large file's bytes overflows the call stack
      const bytes = new Uint8Array(original);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { url, cacheName: `px-release-${release.version}`, original: btoa(bin) };
    });
  });

  await test.step("after a reload the AI is OFF: every call refused with SOFTWARE_TAMPERED and plain words; the console says why", async () => {
    await page.reload();
    await waitForAi(page);
    for (const call of [["manifest"], ["list", "tasks"], ["get", "tasks", "lf-ai-t1"], ["create", "create_rfi", { projectId: P1.id, subject: "s", question: "q" }]] as const) {
      const out = await ai(page, call[0], ...call.slice(1));
      expect(out, `${call[0]} answered while the software was altered`).toMatchObject({ ok: false, code: "SOFTWARE_TAMPERED" });
      expect((out as { message: string }).message).toContain("no longer match");
    }
    await expect.poll(() => errors.some((e) => e.includes("AI access switched off")), { message: "the switch-off was not reported" }).toBe(true);
    expect(laptop.sync.pushed).toEqual([]);
  });

  await test.step("the original file is put back: after a reload the AI is ON again", async () => {
    await page.evaluate(async (t) => {
      const bytes = Uint8Array.from(atob(t.original), (c) => c.charCodeAt(0));
      await (await caches.open(t.cacheName)).put(t.url, new Response(bytes));
    }, target);
    await page.reload();
    await waitForAi(page);
    expect((await aiValue<{ integrity: string }>(page, "manifest")).integrity).toBe("ok");
    expect((await aiValue<{ items: AiRecord[] }>(page, "list", "tasks", { projectId: P1.id })).items.length).toBe(2);
  });

  const installedBefore = await deviceMeta(page, "app:release");
  await test.step("the whole release cache is missing (storage pressure): the AI is OFF ...", async () => {
    await page.evaluate(async () => { for (const n of await caches.keys()) if (n.startsWith("px-release-")) await caches.delete(n); });
    await page.reload();
    await waitForAi(page);
    expect(await ai(page, "manifest")).toMatchObject({ ok: false, code: "SOFTWARE_TAMPERED" });
  });

  await test.step("... and once the app has put the release back (online), it is ON again", async () => {
    await page.unroute("**/_release/**");
    await page.reload();
    await expect.poll(() => releaseCaches(page), { timeout: 240_000, message: "the missing release was not installed again" }).toHaveLength(1);
    // The installer creates the cache FIRST, fills it, and records app:release LAST (installer.ts): wait for that record to be rewritten,
    // or the reload below would check a half-filled cache.
    await expect.poll(async () => JSON.stringify(await deviceMeta(page, "app:release")) !== JSON.stringify(installedBefore), { timeout: 240_000, message: "the reinstall never finished (app:release unchanged)" }).toBe(true);
    await page.reload();
    await waitForAi(page);
    await expect.poll(async () => (await ai<{ integrity: string }>(page, "manifest")), { timeout: 30_000 }).toMatchObject({ ok: true, value: { integrity: "ok" } });
  });
});

test("isolation on one laptop: after a sign-out and ANOTHER person's sign-in, the AI sees only the new person's database", async ({ page, context }) => {
  const people = new Map<string, Person>();
  const net = { mode: "up" as const };
  const sync = await stubSync(context, people, net);
  const first = await prepareLaptop(page, context, "member", { people, sync, net });
  await waitForAi(page);
  await waitForAiIdentity(first);
  expect((await aiValue<{ items: AiRecord[] }>(page, "list", "tasks", { projectId: P1.id })).items.map((i) => i.data.title).sort()).toEqual(["Fix scaffolding east side", "Pour slab level 3"]);

  await test.step("the member signs out from the account menu: the AI doors close", async () => {
    await page.getByRole("button", { name: `Account: ${first.person.email}` }).click();
    await page.getByRole("menuitem", { name: "Sign Out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { projexa?: { ai?: unknown } }).projexa?.ai ?? null), { message: "the signed-out person's AI is still on the page" }).toBeNull();
  });

  const second: Person = PEOPLE.other_org;
  const session = await test.step("another person (of ANOTHER organisation) signs in through the real login form", async () => {
    await context.clearCookies();
    const res = await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(second.email)}`);
    const made = (await res.json()) as LocalSession;
    people.set(made.userId, second);
    const sessionJson = Buffer.from(made.cookieValue.slice("base64-".length), "base64url").toString("utf8");
    // The Auth stand-in's own /verify would mint a made-up person; the login form must get THIS person, as the real service would.
    await stubAuthOtp(context, JSON.parse(sessionJson));
    first.current.person = second;
    first.current.session = made;
    await signInByCode(page, second.email, { stayOnPage: true, leaves: /\/dashboard/ });
    // the second person's own workspace is prepared (lf-e11 fix: the "skipped in this tab" marker is per person)
    await expect(page.getByTestId("workspace-prepare"), "the 'Preparing your PROJEXA workspace' screen never finished and opened PROJEXA").toHaveCount(0, { timeout: 240_000 });
    await expect.poll(() => personMeta(page, made.userId, `sync:done:${Q1.id}:tasks`), { timeout: 120_000, message: "the second person's tasks never reached the laptop" }).toBeTruthy();
    await stayOnServerPage(page, "/dashboard");
    return made;
  });

  await test.step("the screen is the new person's: their organisation, never the first person's organisation or project names", async () => {
    // lf-e11 fix (shell-store dropShellIfNotFor): the shell's bootstrap is not carried over from the previous person
    await expect(page.getByText("Other Org Ltd").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Harbor Builders")).toHaveCount(0);
    await expect(page.getByText(P1.name)).toHaveCount(0);
  });

  await test.step("the AI works for the NEW person only: their organisation, their project, none of the first person's rows", async () => {
    await waitForAi(page);
    await expect.poll(async () => (await ai<{ organisation: { id: string } }>(page, "manifest")), { timeout: 60_000 }).toMatchObject({ ok: true, value: { organisation: { id: ORG_B } } });
    const m = await aiValue<{ person: { id: string; name: string; role: string }; projects: { id: string }[] }>(page, "manifest");
    expect(m.person).toMatchObject({ id: session.userId, name: second.name });
    expect(m.projects.map((p) => p.id)).toEqual([Q1.id]);
    expect((await aiValue<{ items: AiRecord[] }>(page, "list", "tasks")).items.map((i) => i.data.title)).toEqual(["Other org mall task"]);
    expect(await aiValue(page, "get", "tasks", "lf-ai-t1")).toBeNull();
    expect((await aiValue<{ items: unknown[] }>(page, "search", "slab")).items).toEqual([]);
    expect(await ai(page, "list", "tasks", { projectId: P1.id })).toMatchObject({ ok: false, code: "PROJECT_NOT_YOURS" });
    expect(await ai(page, "create", "create_rfi", { projectId: P1.id, subject: "s", question: "q" })).toMatchObject({ ok: false, code: "PROJECT_NOT_YOURS" });
    // the first person's copy is still on the laptop (sign-out keeps it by default), it is simply not reachable
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(dbs).toContain(`projexa-local:${first.session.userId}`);
    expect(dbs).toContain(`projexa-local:${session.userId}`);
  });
});
