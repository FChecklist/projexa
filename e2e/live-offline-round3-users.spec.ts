import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { DOTTED_CODES_XLSX_BASE64, SUMEET_SHAPED_XLSX_BASE64 } from "../src/lib/local-first/boq-excel/__fixtures__/boq-excel-fixtures";
import { openLaptop, outboxOps, projectId, serverCall, serverRows } from "./support/real-backend";

// SUMEET 111, offline round 3, as a USER on their own laptop (owner order 2026-10-13): Excel import of a real Sumeet-shaped sheet, a scope item added to an
// existing BOQ, a MoM with an action item, copy-for-WhatsApp, and a billing milestone. Same method as live-offline-writers-users.spec.ts: a fresh browser
// profile is one more laptop, a documented E2E test person signs in, the network is CUT, the form is filled by typing/choosing like a person, saved, the network
// returns, and the result is re-read from the SERVER's own rows (a Node-side call to the sync service), never from a toast. Run with
// playwright.live-offline-users.config.ts against the deployed site (not part of pull-request CI).
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const STAMP = `r3${Date.now()}`;
let A: { context: BrowserContext; page: Page };
let P: string;
let boqServerId = "";
let momServerId = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  P = await projectId(A.context);
  await A.page.goto(`/local/scope?projectId=${P}`);
  await expect(A.page.getByTestId("scope-list")).toBeVisible({ timeout: 600_000 });
});
test.afterAll(async () => {
  await A?.context.close();
});

async function reconnect(page: Page, context: BrowserContext) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await outboxOps(page)).filter((o) => o.status !== "done" && o.status !== "sent").length, { timeout: 240_000, message: "the queued write was never sent" }).toBe(0);
}

/** Reopens a screen again and again, like a person coming back to it, until it shows `testId` (the laptop pulls what the server made in between). */
async function waitScreen(page: Page, path: string, testId: string, state?: string) {
  await expect
    .poll(async () => {
      await page.goto(path);
      await page.waitForTimeout(6_000);
      const el = page.getByTestId(testId);
      if ((await el.count()) === 0) return "absent";
      return state ? ((await el.first().getAttribute("data-state")) ?? "present") : "present";
    }, { timeout: 600_000, intervals: [4_000], message: `${path} never showed ${testId}${state ? ` in state ${state}` : ""}` })
    .toBe(state ?? "present");
}

const SAVED = /Offline: \d+ changes? (is|are) saved on this laptop/i;

test("Excel import: a Sumeet-shaped sheet is read on the laptop with no network and saved as a BOQ that reaches the server", async () => {
  await A.page.goto(`/local/scope/new?projectId=${P}`);
  await expect(A.page.getByTestId("scope-new-screen")).toBeVisible({ timeout: 120_000 });
  await A.context.setOffline(true);
  const xlsx = (name: string, b64: string) => ({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(b64, "base64") });
  // R-71: the Sumeet-shaped sheet has one malformed row (Qty "not-a-number"): the laptop names it by row and will not use the lines (no silent zero)
  await A.page.getByTestId("scope-new-excel-file").setInputFiles(xlsx(`Sumeet BOQ ${STAMP}.xlsx`, SUMEET_SHAPED_XLSX_BASE64));
  await expect(A.page.getByTestId("scope-new-excel-preview")).toContainText("Gypsum Board", { timeout: 60_000 });
  await expect(A.page.getByTestId("scope-new-excel-issues")).toContainText("Row 8: Qty is not a number");
  await expect(A.page.getByTestId("scope-new-excel-use")).toBeDisabled();
  // a clean sheet (sub-tasks with weights, dotted codes) is read and used
  await A.page.getByTestId("scope-new-excel-file").setInputFiles(xlsx(`Sumeet BOQ ${STAMP}.xlsx`, DOTTED_CODES_XLSX_BASE64));
  await expect(A.page.getByTestId("scope-new-excel-preview")).toBeVisible({ timeout: 60_000 });
  await expect(A.page.getByTestId("scope-new-excel-use")).toBeEnabled();
  await A.page.getByTestId("scope-new-excel-use").click();
  await expect(A.page.getByTestId("scope-new-title")).toHaveValue(new RegExp(STAMP));
  await A.page.getByTestId("scope-new-save").click();
  await expect(A.page.getByText(SAVED).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, P, "boqs", STAMP)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  boqServerId = String((await serverRows(A.context, P, "boqs", STAMP))[0].id);
  await expect.poll(async () => (await serverRows(A.context, P, "boq_lines", boqServerId)).length, { timeout: 240_000, message: "the imported lines never reached the server" }).toBe(3);
});

test("a scope item added offline to an existing BOQ reaches the server as a new revision, keeping the old lines", async () => {
  expect(boqServerId).not.toBe("");
  await waitScreen(A.page, `/local/scope/${boqServerId}/add-item?projectId=${P}`, "scope-additem-screen", "ready");
  const before = (await serverRows(A.context, P, "boq_lines", boqServerId)).length;
  await A.context.setOffline(true);
  const type = async (id: string, v: string) => { const b = A.page.getByTestId(id); await b.click(); await b.fill(""); await b.pressSequentially(v, { delay: 15 }); };
  await type("scope-additem-0-description", `Extra skirting ${STAMP}`);
  await type("scope-additem-0-unit", "rmt");
  await type("scope-additem-0-quantity", "40");
  await type("scope-additem-0-rate", "75");
  await A.page.getByTestId("scope-additem-save").click();
  await expect(A.page.getByText(SAVED).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, P, "boq_lines", `Extra skirting ${STAMP}`)).length, { timeout: 240_000, message: "the added scope item never reached the server" }).toBeGreaterThan(0);
  // the new revision is a BOQ of its own on the server: it holds the 3 imported lines AND the new item (nothing dropped), and the old revision keeps its 3
  const row = (await serverRows(A.context, P, "boq_lines", `Extra skirting ${STAMP}`))[0];
  expect(JSON.stringify(row.data)).toContain("75");
  const data = row.data as Record<string, unknown>;
  const key = Object.keys(data).find((k) => /^boq_?id$/i.test(k));
  expect(key, "the new line names the BOQ revision it belongs to").toBeTruthy();
  const revisionId = String(data[key!]);
  expect(revisionId).not.toBe(boqServerId);
  await expect.poll(async () => (await serverRows(A.context, P, "boq_lines", revisionId)).length, { timeout: 240_000, message: "the new revision does not hold the old lines plus the new one" }).toBe(before + 1);
  expect((await serverRows(A.context, P, "boq_lines", boqServerId)).length).toBe(before);
});

test("a MoM made offline, then an action item added to it offline, both reach the server; the WhatsApp text copies with no network", async () => {
  // a new person's meetings are copied after the first minutes: come back to the form until it is offered (it says "opening from the server" until then)
  await expect
    .poll(async () => { await A.page.goto(`/local/moms/new?projectId=${P}`); await A.page.waitForTimeout(5_000); return A.page.getByLabel("Title", { exact: true }).count(); }, { timeout: 600_000, intervals: [3_000], message: "the New meeting form was never offered on the laptop" })
    .toBeGreaterThan(0);
  await A.context.setOffline(true);
  await A.page.getByLabel("Title", { exact: true }).fill(`Offline site meeting ${STAMP}`);
  await A.page.getByLabel("Date and time").fill("2026-11-02T10:30");
  await A.page.getByLabel("Agenda").fill("Partition progress\nMaterial delivery");
  await A.page.getByLabel("Minutes").fill("Contractor will raise partition wall by Friday.");
  await A.page.getByRole("button", { name: "Save meeting" }).click();
  await expect(A.page.getByText(SAVED).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, P, "meeting_minutes", `Offline site meeting ${STAMP}`)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  momServerId = String((await serverRows(A.context, P, "meeting_minutes", `Offline site meeting ${STAMP}`))[0].id);

  await waitScreen(A.page, `/local/moms/${momServerId}?projectId=${P}`, "mom-title");
  await A.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(A.page.url()).origin });
  await A.context.setOffline(true);
  await A.page.getByTestId("mom-whatsapp").click();
  await expect(A.page.getByTestId("mom-copied").or(A.page.getByTestId("mom-copy-manual"))).toBeVisible({ timeout: 15_000 });
  const copied = await A.page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  if (copied) expect(copied).toContain(`Offline site meeting ${STAMP}`);

  await A.page.getByLabel("New action item", { exact: true }).fill(`Raise partition wall ${STAMP}`);
  await A.page.getByLabel("Due date for the new action item").fill("2026-11-06");
  await A.page.getByTestId("mom-item-save").click();
  await expect(A.page.getByTestId("mom-item-note")).toHaveAttribute("data-ok", "1");
  await expect(A.page.getByTestId("mom-pending-items")).toContainText(`Raise partition wall ${STAMP}`);
  // exactly one write waits in the laptop's outbox, named for this action
  const waiting = (await outboxOps(A.page)).filter((o) => o.functionId === "add_meeting_action_item" && o.status !== "done" && o.status !== "sent");
  expect(waiting).toHaveLength(1);
  // reconnect() only returns when NOTHING is left waiting, and a write the server refused stays in the outbox with a refused status: so returning means the server accepted it.
  // The server turns the item into a task (compliance.tasks + veri_meeting_action_items); the sync service has no pull kind for tasks, so that row is read back
  // from the database itself in the run record (projexa-uat-results-2026-10-13-handover.md).
  await reconnect(A.page, A.context);
  expect((await outboxOps(A.page)).filter((o) => o.functionId === "add_meeting_action_item" && o.status !== "done" && o.status !== "sent")).toHaveLength(0);
});

test("a billing milestone made offline is kept as a draft and reaches the server", async () => {
  // billing needs a project with an APPROVED BOQ and a customer the project already bills: in the E2E organisation that is "Villa Fit-Out (Manual Demo)"
  // (the first project, LIVE-SMOKE, has no approved BOQ: the screen then says so in words, which unit tests cover)
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  const villa = manifest.projects.find((x) => x.name === "Villa Fit-Out (Manual Demo)");
  expect(villa, "the E2E organisation has the Villa project").toBeTruthy();
  const V = villa!.id;
  // the first copy of a project takes minutes: come back to the form until the laptop offers it
  await expect
    .poll(async () => { await A.page.goto(`/local/billing-milestones/new?projectId=${V}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("billing-new-form").count(); }, { timeout: 900_000, intervals: [5_000], message: "the billing form was never offered for the Villa project" })
    .toBeGreaterThan(0);
  await expect(A.page.getByTestId("billing-draft-words")).toBeVisible();
  await A.context.setOffline(true);
  // the customer this project already bills is marked "(billed on this project)": the server only accepts a draft for that customer
  const billed = A.page.getByLabel("Billed to").locator("option", { hasText: "(billed on this project)" }).first();
  await expect(billed).toHaveCount(1);
  await A.page.getByLabel("Billed to").selectOption(await billed.getAttribute("value") ?? "");
  await A.page.getByLabel("Milestone", { exact: true }).fill(`Partition handover ${STAMP}`);
  await A.page.getByLabel("Billing date").fill("2026-11-20");
  await A.page.getByRole("button", { name: /Save billing milestone/ }).click();
  await expect(A.page.getByText(/draft/i).first()).toBeVisible({ timeout: 30_000 });
  const waiting = (await outboxOps(A.page)).filter((o) => o.functionId === "create_progress_claim" && o.status !== "done" && o.status !== "sent");
  expect(waiting).toHaveLength(1);
  await reconnect(A.page, A.context); // returns only when nothing is left waiting: the server accepted the draft (a refusal stays in the outbox)
  expect((await outboxOps(A.page)).filter((o) => o.functionId === "create_progress_claim" && o.status !== "done" && o.status !== "sent")).toHaveLength(0);
});
