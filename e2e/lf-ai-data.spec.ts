import { test, expect, type Page } from "@playwright/test";
import { LIVE_WRITES } from "../src/lib/local-first/ai/__fixtures__/live-registry-contract";
import { ai, aiValue, goOffline, goOnline, prepareLaptop, waitForAi, waitForAiIdentity, type Laptop } from "./support/lf-ai-laptop";
import { P1, P2, P_HIDDEN, Q1, type PushedOp } from "./support/lf-ai-stub";

// LOCAL-FIRST browser AI (package lf-e11), R6 + R7 + R1/R2: an outside AI works on the PERSON'S data through window.projexa.ai only
// (page.evaluate, no private import): it reads the laptop's own rows as the server redacted them for the role, never another project's or
// organisation's; it creates and changes records through the outbox (shown at once, sent ONCE, with the live registry's parameter
// names); its deletes are drafts the person confirms with a real click; and all of it works with the network OFF.
//
// Runs through playwright.local-first.config.ts; see e2e/lf-ai-discovery.spec.ts for the arrangement.

type AiRecord = { kind: string; id: string; projectId: string | null; pending: boolean; data: Record<string, unknown> };
type List = { kind: string; items: AiRecord[]; truncated: boolean };

const titles = (l: List) => l.items.map((i) => String(i.data.title ?? i.data.subject ?? i.data.name)).sort();

/** The op as the REAL registry would take it: a live write, every param a declared name, every required one present. */
function expectLiveShape(op: PushedOp) {
  const spec = LIVE_WRITES[op.function_id];
  expect(spec, `${op.function_id} is not a write of the live registry`).toBeTruthy();
  for (const key of Object.keys(op.params)) expect(spec.declared, `${op.function_id} was sent "${key}", which the live registry does not take`).toContain(key);
  for (const req of spec.required) {
    expect(req.any_of.some((n) => op.params[n] !== undefined && op.params[n] !== null && op.params[n] !== ""), `${op.function_id} was sent without ${req.name}`).toBe(true);
  }
}

/** Waits until every project of the person has its tasks copied (the first sync copies them one after another). */
async function allProjectsCopied(laptop: Laptop) {
  await expect
    .poll(async () => titles(await aiValue<List>(laptop.page, "list", "tasks")).length, { timeout: 120_000, message: "not every project's tasks reached the laptop" })
    .toBe(laptop.person.projects.length === 2 ? 3 : laptop.person.projects.length === 1 ? 2 : 4);
}

/** Sends whatever waits in the outbox (the outbox also flushes by itself; this is the browser's own `online` event). */
const nudge = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

test("R6 reads: the member's AI reads the laptop's rows, only their projects and organisation, with money as their role may see it", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "member");
  await waitForAi(page);
  await waitForAiIdentity(laptop);
  await allProjectsCopied(laptop);

  await test.step("list: one project, then all of the person's projects; never the project they may not read, never another organisation", async () => {
    expect(titles(await aiValue<List>(page, "list", "tasks", { projectId: P1.id }))).toEqual(["Fix scaffolding east side", "Pour slab level 3"]);
    expect(titles(await aiValue<List>(page, "list", "tasks"))).toEqual(["Fix scaffolding east side", "Paint villa lobby", "Pour slab level 3"]);
    expect(await ai(page, "list", "tasks", { projectId: P_HIDDEN.id })).toMatchObject({ ok: false, code: "PROJECT_NOT_YOURS" });
    expect(await ai(page, "list", "tasks", { projectId: Q1.id })).toMatchObject({ ok: false, code: "PROJECT_NOT_YOURS" });
    // the laptop never even asked the server for a project it was not given
    expect(laptop.sync.refusedPulls).toEqual([]);
  });

  await test.step("filter and limit work on the laptop's copy", async () => {
    const high = await aiValue<List>(page, "list", "tasks", { filter: { priority: "high" } });
    expect(titles(high)).toEqual(["Pour slab level 3"]);
    const one = await aiValue<List>(page, "list", "tasks", { projectId: P1.id, limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(one.truncated).toBe(true);
  });

  await test.step("get: a row it holds; null for one of another project/organisation", async () => {
    const t1 = await aiValue<AiRecord | null>(page, "get", "tasks", "lf-ai-t1");
    expect(t1).toMatchObject({ kind: "tasks", id: "lf-ai-t1", projectId: P1.id, pending: false, data: { title: "Pour slab level 3", priority: "high" } });
    expect(await aiValue(page, "get", "tasks", "lf-ai-th")).toBeNull();
    expect(await aiValue(page, "get", "tasks", "lf-ai-q-t1")).toBeNull();
  });

  await test.step("search: finds across kinds on the laptop; nothing of the hidden project or the other organisation", async () => {
    const hinge = await aiValue<{ items: AiRecord[] }>(page, "search", "hinge");
    expect(hinge.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["rfis:lf-ai-r1"]);
    const secret = await aiValue<{ items: AiRecord[] }>(page, "search", "secret");
    expect(secret.items).toEqual([]);
    const mall = await aiValue<{ items: AiRecord[] }>(page, "search", "mall");
    expect(mall.items).toEqual([]);
  });

  await test.step("money: a member (the fixture's money rank) sees the BOQ rate and amount", async () => {
    const lines = await aiValue<List>(page, "list", "boq_lines", { projectId: P1.id });
    expect(lines.items.map((l) => [l.data.rate, l.data.amount])).toEqual([["12.50", "1250.00"]]);
  });
});

test("R4/R6 role redaction: a viewer's AI gets money as null (the server's redaction is kept, never undone on the laptop), and cannot write", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "viewer");
  await waitForAi(page);
  await waitForAiIdentity(laptop);
  await expect.poll(async () => (await aiValue<List>(page, "list", "boq_lines", { projectId: P1.id })).items.length, { timeout: 120_000 }).toBe(1);

  const lines = await aiValue<List>(page, "list", "boq_lines", { projectId: P1.id });
  expect(lines.items[0].data).toMatchObject({ description: "Blockwork 200mm", quantity: "100", rate: null, amount: null });
  const receipts = await aiValue<List>(page, "list", "material_receipts", { projectId: P1.id });
  expect(receipts.items[0].data).toMatchObject({ number: "GRN-7", quantity: 40, unit_cost: null });
  // no search can dig the hidden figure out either
  expect((await aiValue<{ items: AiRecord[] }>(page, "search", "1250")).items).toEqual([]);

  const manifest = await aiValue<{ person: { role: string; roleRank: number }; functions: Record<string, unknown[]> }>(page, "manifest");
  expect(manifest.person).toMatchObject({ role: "viewer", roleRank: 1 });
  expect(Object.values(manifest.functions).flat()).toEqual([]);

  const create = await ai(page, "create", "create_rfi", { projectId: P1.id, subject: "Viewer RFI", question: "May I?" });
  expect(create).toMatchObject({ ok: false, code: "ROLE_TOO_LOW" });
  expect((create as { message: string }).message).toContain("viewer");
  const update = await ai(page, "update", "update_task", { kind: "tasks", id: "lf-ai-t1" }, { projectId: P1.id, issueId: "lf-ai-t1", title: "Viewer edit" });
  expect(update).toMatchObject({ ok: false, code: "ROLE_TOO_LOW" });
  await nudge(page);
  await page.waitForTimeout(1_000);
  expect(laptop.sync.pushed, "a viewer's refused write was sent anyway").toEqual([]);
  expect(titles(await aiValue<List>(page, "list", "rfis", { projectId: P1.id }))).toEqual(["Door hinge finish"]);
});

test("R7 create/update: queued with the optimistic change, shown on the person's screen, sent ONCE with the live registry's names", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "member");
  await waitForAi(page);
  await waitForAiIdentity(laptop);

  const created = await test.step("create_rfi: queued at once with a temporary id, visible to the AI as pending", async () => {
    const res = await aiValue<{ status: string; opId: string; tempId: string; message: string }>(page, "create", "create_rfi", { projectId: P1.id, subject: "Window seal colour", question: "Grey or black sealant?" });
    expect(res).toMatchObject({ status: "queued", opId: expect.any(String), tempId: expect.stringMatching(/^local-/) });
    expect(res.message).toContain("will reach the server");
    return res;
  });

  await test.step("it is sent ONCE, as create_rfi with the registry's parameter names, and the server's row replaces the temporary one", async () => {
    await expect.poll(() => laptop.sync.pushed.filter((o) => o.function_id === "create_rfi").length, { timeout: 60_000, message: "the AI's RFI was never sent" }).toBe(1);
    const op = laptop.sync.pushed.find((o) => o.function_id === "create_rfi")!;
    expect(op).toMatchObject({ op_id: created.opId, project_id: P1.id, params: { projectId: P1.id, subject: "Window seal colour", question: "Grey or black sealant?" } });
    expectLiveShape(op);
    await expect.poll(async () => (await aiValue<List>(page, "list", "rfis", { projectId: P1.id })).items.map((i) => [i.data.subject, i.pending]).sort(), { timeout: 30_000 })
      .toEqual([["Door hinge finish", false], ["Window seal colour", false]]);
  });

  await test.step("update_task: the title changes on the laptop at once and shows on the Schedule screen", async () => {
    const res = await aiValue<{ status: string; opId: string }>(page, "update", "update_task", { kind: "tasks", id: "lf-ai-t1" }, { projectId: P1.id, issueId: "lf-ai-t1", title: "Pour slab level 3 (AI)" });
    expect(res.status).toBe("queued");
    const t1 = await aiValue<AiRecord>(page, "get", "tasks", "lf-ai-t1");
    expect(t1.data.title).toBe("Pour slab level 3 (AI)");
    await page.goto(`/local/schedule?projectId=${P1.id}`);
    await expect(page.getByTestId("schedule-row").filter({ hasText: "Pour slab level 3 (AI)" })).toHaveCount(1);
    await expect.poll(() => laptop.sync.pushed.filter((o) => o.function_id === "update_task").length, { timeout: 60_000, message: "the AI's task change was never sent" }).toBe(1);
    const op = laptop.sync.pushed.find((o) => o.function_id === "update_task")!;
    expect(op).toMatchObject({ project_id: P1.id, params: { projectId: P1.id, issueId: "lf-ai-t1", title: "Pour slab level 3 (AI)" }, record: { kind: "tasks", id: "lf-ai-t1", base_version: 1 } });
    expect("taskId" in op.params).toBe(false);
    expectLiveShape(op);
  });

  await test.step("create_schedule_task: a new task shows on the Schedule screen at once, and is sent once with the registry's names", async () => {
    const res = await aiValue<{ status: string; tempId: string }>(page, "create", "create_schedule_task", { projectId: P1.id, title: "Install site hoarding (AI)", startDate: "2026-10-06", dueDate: "2026-10-08", priority: "medium" });
    expect(res).toMatchObject({ status: "queued", tempId: expect.stringMatching(/^local-/) });
    // On the person's screen at once (as the pending row) or, when the push has already settled, as the server's row: the laptop never
    // loses it. A pull that was already in flight when the push settled can miss the new row until the next change-feed pass, so the
    // check nudges a sync and reopens the screen between looks instead of staring at one render.
    await expect.poll(async () => {
      await page.goto(`/local/schedule?projectId=${P1.id}`);
      await expect(page.getByTestId("schedule-row").first()).toBeVisible();
      const n = await page.getByTestId("schedule-row").filter({ hasText: "Install site hoarding (AI)" }).count();
      if (n === 0) await nudge(page);
      return n;
    }, { timeout: 60_000, intervals: [500, 1_000, 2_000], message: "the AI's new task never showed on the Schedule screen" }).toBe(1);
    await expect.poll(() => laptop.sync.pushed.filter((o) => o.function_id === "create_schedule_task").length, { timeout: 60_000, message: "the AI's task was never sent" }).toBe(1);
    const op = laptop.sync.pushed.find((o) => o.function_id === "create_schedule_task")!;
    expect(op.params).toEqual({ projectId: P1.id, title: "Install site hoarding (AI)", startDate: "2026-10-06", dueDate: "2026-10-08", priority: "medium" });
    expectLiveShape(op);
  });

  await test.step("nothing is ever sent twice (a later online event and a reload do not resend applied ops)", async () => {
    await waitForAi(page);
    await nudge(page);
    await page.reload();
    await waitForAi(page);
    await nudge(page);
    await page.waitForTimeout(2_000);
    expect(laptop.sync.pushed.map((o) => o.function_id).sort()).toEqual(["create_rfi", "create_schedule_task", "update_task"]);
    // A resend happens when an answer was lost (the page navigated away mid-request): it must carry the SAME op_id, so the server's
    // exactly-once ledger answers `duplicate` and nothing runs twice. A new op_id for the same change would be a double write.
    const ids = new Set(laptop.sync.pushed.map((o) => o.op_id));
    for (const r of laptop.sync.resent) expect(ids.has(r.op_id), `${r.function_id} was resent under a NEW op_id`).toBe(true);
  });

  await test.step("refusals are clear and queue nothing: unknown function, wrong action, missing and unknown params, another project", async () => {
    expect(await ai(page, "create", "make_coffee", { projectId: P1.id })).toMatchObject({ ok: false, code: "UNKNOWN_FUNCTION" });
    expect(await ai(page, "create", "update_task", { projectId: P1.id, issueId: "lf-ai-t1" })).toMatchObject({ ok: false, code: "WRONG_ACTION" });
    expect(await ai(page, "create", "create_rfi", { projectId: P1.id, subject: "no question" })).toMatchObject({ ok: false, code: "MISSING_PARAMS" });
    expect(await ai(page, "update", "update_task", { kind: "tasks", id: "lf-ai-t1" }, { projectId: P1.id, taskId: "lf-ai-t1", title: "x" })).toMatchObject({ ok: false, code: "UNKNOWN_PARAMS" });
    expect(await ai(page, "create", "create_rfi", { projectId: P_HIDDEN.id, subject: "s", question: "q" })).toMatchObject({ ok: false, code: "PROJECT_NOT_YOURS" });
    expect(await ai(page, "create", "create_rfi", { projectId: Q1.id, subject: "s", question: "q" })).toMatchObject({ ok: false, code: "PROJECT_NOT_YOURS" });
    await nudge(page);
    await page.waitForTimeout(1_000);
    expect(laptop.sync.pushed).toHaveLength(3);
  });
});

test("R7 delete: a DRAFT in 'Requests from your AI'; the AI cannot confirm it; the person's click sends exactly one op; 'act without asking' sends routine deletes directly but never money", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "manager");
  await waitForAi(page);
  await waitForAiIdentity(laptop);
  const VOID = { projectId: P1.id, receiptId: "lf-ai-mr1", reason: "Duplicate GRN" };

  const draft = await test.step("delete() writes nothing: it makes a draft the person sees", async () => {
    const res = await aiValue<{ status: string; draftId: string; message: string }>(page, "delete", "void_material_receipt", { kind: "material_receipts", id: "lf-ai-mr1" }, VOID);
    expect(res).toMatchObject({ status: "draft", draftId: expect.stringMatching(/^draft-/) });
    expect(res.message).toContain("must confirm");
    const box = page.getByRole("region", { name: "Requests from your AI" });
    await expect(box).toBeVisible();
    await expect(box).toContainText("Void a material receipt");
    await expect(box).toContainText("GRN-7");
    return res;
  });

  await test.step("the AI has no way to confirm: no confirm on the surface, the drafts it reads are copies, a scripted click is ignored", async () => {
    const surface = await page.evaluate(() => Object.keys((window as unknown as { projexa: { ai: object } }).projexa.ai));
    expect(surface.filter((k) => /confirm|approve|accept/i.test(k))).toEqual([]);
    // a copy changed by the AI changes nothing
    await page.evaluate(async () => {
      const ds = await (window as unknown as { projexa: { ai: { drafts(): Promise<{ params: Record<string, unknown> }[]> } } }).projexa.ai.drafts();
      ds[0].params.receiptId = "something-else";
    });
    expect((await aiValue<{ draftId: string; params: Record<string, unknown> }[]>(page, "drafts")).map((d) => [d.draftId, d.params.receiptId])).toEqual([[draft.draftId, "lf-ai-mr1"]]);
    // a script "clicking" the confirm button is not a person: event.isTrusted is false, nothing happens
    await page.evaluate(() => (document.querySelector('[aria-label^="Confirm:"]') as HTMLButtonElement).click());
    await page.evaluate(() => document.querySelector('[aria-label^="Confirm:"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await nudge(page);
    await page.waitForTimeout(1_500);
    expect(laptop.sync.pushed).toEqual([]);
    expect(await aiValue<unknown[]>(page, "drafts")).toHaveLength(1);
  });

  await test.step("the person's real click confirms it: exactly ONE void_material_receipt op, with the registry's names", async () => {
    await page.getByRole("button", { name: "Confirm: Void a material receipt" }).click();
    await expect.poll(() => laptop.sync.pushed.length, { timeout: 60_000, message: "the confirmed delete was never sent" }).toBe(1);
    const op = laptop.sync.pushed[0];
    expect(op).toMatchObject({ function_id: "void_material_receipt", project_id: P1.id, params: VOID, record: { kind: "material_receipts", id: "lf-ai-mr1", base_version: 1 } });
    expectLiveShape(op);
    expect(await aiValue<unknown[]>(page, "drafts")).toEqual([]);
    await nudge(page);
    await page.waitForTimeout(1_500);
    expect(laptop.sync.pushed).toHaveLength(1);
  });

  await test.step("'Keep it' drops a draft and sends nothing", async () => {
    await aiValue(page, "delete", "dispose_document", { kind: "documents", id: "lf-ai-d1" }, { projectId: P1.id, documentId: "lf-ai-d1" });
    await page.getByRole("button", { name: /^Keep it: do not dispose of a document/ }).click();
    expect(await aiValue<unknown[]>(page, "drafts")).toEqual([]);
    await nudge(page);
    await page.waitForTimeout(1_000);
    expect(laptop.sync.pushed).toHaveLength(1);
  });
});

test("R7 'let my AI act without asking' (the person's own switch, from the server): a routine delete goes at once; a money one is still a draft", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "manager", { person: { actWithoutAsking: true } });
  await waitForAi(page);
  await expect.poll(async () => (await aiValue<{ settings: { aiActWithoutAsking: boolean } }>(page, "manifest")).settings.aiActWithoutAsking, { timeout: 60_000 }).toBe(true);

  const routine = await aiValue<{ status: string }>(page, "delete", "dispose_document", { kind: "documents", id: "lf-ai-d1" }, { projectId: P1.id, documentId: "lf-ai-d1" });
  expect(routine.status).toBe("queued");
  await expect.poll(() => laptop.sync.pushed.map((o) => o.function_id), { timeout: 60_000 }).toEqual(["dispose_document"]);
  expectLiveShape(laptop.sync.pushed[0]);

  const money = await aiValue<{ status: string }>(page, "delete", "void_material_receipt", { kind: "material_receipts", id: "lf-ai-mr1" }, { projectId: P1.id, receiptId: "lf-ai-mr1", reason: "Duplicate" });
  expect(money.status, "a money-sensitive delete skipped the person's confirmation").toBe("draft");
  await expect(page.getByRole("region", { name: "Requests from your AI" })).toContainText("Void a material receipt");
  await nudge(page);
  await page.waitForTimeout(1_500);
  expect(laptop.sync.pushed.map((o) => o.function_id)).toEqual(["dispose_document"]);
});

test("R1/R2 offline: with the network OFF every read and write works on the laptop, and the writes go once it is back", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "manager");
  await waitForAi(page);
  await waitForAiIdentity(laptop);
  await allProjectsCopied(laptop);
  // the page must be controlled by the service worker so it opens offline
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: "the service worker does not control the page" }).toBe(true);

  await goOffline(laptop);
  await test.step("offline: the AI surface is there on a freshly opened page (the laptop's own shell)", async () => {
    await page.goto(`/local/schedule?projectId=${P1.id}`);
    await expect(page.getByTestId("schedule-row")).toHaveCount(2);
    await waitForAi(page, "window.projexa.ai is missing on a page opened offline");
  });

  await test.step("offline: manifest, list, get, search", async () => {
    const m = await aiValue<{ person: { role: string }; projects: { id: string }[] }>(page, "manifest");
    expect(m.person.role).toBe("manager");
    expect(titles(await aiValue<List>(page, "list", "tasks", { projectId: P1.id }))).toEqual(["Fix scaffolding east side", "Pour slab level 3"]);
    expect(await aiValue<AiRecord>(page, "get", "rfis", "lf-ai-r1")).toMatchObject({ data: { subject: "Door hinge finish" } });
    expect((await aiValue<{ items: AiRecord[] }>(page, "search", "scaffolding")).items.map((i) => i.id)).toEqual(["lf-ai-t2"]);
  });

  await test.step("offline: create, update and a confirmed delete are kept on the laptop and NOT sent", async () => {
    await aiValue(page, "create", "create_rfi", { projectId: P1.id, subject: "Offline RFI", question: "Made with no network?" });
    await aiValue(page, "update", "update_task", { kind: "tasks", id: "lf-ai-t2" }, { projectId: P1.id, issueId: "lf-ai-t2", title: "Scaffolding (offline edit)" });
    await aiValue(page, "delete", "void_material_receipt", { kind: "material_receipts", id: "lf-ai-mr1" }, { projectId: P1.id, receiptId: "lf-ai-mr1", reason: "Offline void" });
    await page.getByRole("button", { name: "Confirm: Void a material receipt" }).click();
    await expect(page.getByRole("region", { name: "Requests from your AI" }).getByRole("status")).toContainText("will reach the server");
    expect(titles(await aiValue<List>(page, "list", "rfis", { projectId: P1.id }))).toEqual(["Door hinge finish", "Offline RFI"]);
    // the Schedule screen reads the laptop's database when it opens: the AI's change is on it (offline reload, served by the worker)
    await page.reload();
    await expect(page.getByTestId("schedule-row").filter({ hasText: "Scaffolding (offline edit)" })).toHaveCount(1);
    expect(laptop.sync.pushed).toEqual([]);
  });

  await test.step("back online: the three writes are sent, each once", async () => {
    await goOnline(laptop);
    await nudge(page);
    await expect.poll(() => laptop.sync.pushed.map((o) => o.function_id).sort(), { timeout: 90_000, message: "the offline writes were never sent" })
      .toEqual(["create_rfi", "update_task", "void_material_receipt"]);
    for (const op of laptop.sync.pushed) expectLiveShape(op);
    await nudge(page);
    await page.waitForTimeout(2_000);
    expect(laptop.sync.pushed).toHaveLength(3);
  });
});
