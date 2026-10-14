import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { localRows, openLaptop, openLocal, outboxOps, projectId, serverRows } from "./support/real-backend";

// SUMEET 111, offline writers, as a USER on their own laptop (owner order 2026-10-13: every use case runs from the user's own laptop and works offline).
// Against the REAL deployed site and backend (playwright.live-offline-users.config.ts): a fresh browser profile = one more laptop, a documented E2E test
// person signs in (project manager), the first copy of their data is made, then for each writer: the network is CUT (context.setOffline), the form is
// filled by typing like a person, saved, the network comes back, and the outcome is re-read from the SERVER's own rows (a Node-side call to the sync
// service, independent of the browser), never from a toast. Every test fails if its writer is broken (R74-RULING-03).
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const STAMP = `u${Date.now()}`;
let A: { context: BrowserContext; page: Page };
let P: string;
let boqServerId = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  P = await projectId(A.context);
  // the first copy of a new person's projects takes minutes: wait until THIS project's BOQ list is on the laptop before working in it
  await openLocal(A.page, `/local/scope?projectId=${P}`, "scope-list");
});
test.afterAll(async () => {
  await A?.context.close();
});

/** Waits until every queued write of the laptop has been sent (nothing pending in the outbox) after the network is back. */
async function reconnect(page: Page, context: BrowserContext) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await outboxOps(page)).filter((o) => o.status !== "done" && o.status !== "sent").length, { timeout: 240_000, message: "the queued write was never sent" }).toBe(0);
}

/** Opens a FORM screen of the offline shell (they show data-state=ready, not the list screens' data-state=local) and waits until it is on screen. */
async function openForm(page: Page, path: string, testId: string) {
  await page.goto(path);
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 120_000 });
}

async function type(page: Page, testId: string, text: string) {
  const box = page.getByTestId(testId);
  await box.click();
  await box.fill("");
  await box.pressSequentially(text, { delay: 15 });
}

test("a new BOQ made offline reaches the server with its line", async () => {
  await openForm(A.page, `/local/scope/new?projectId=${P}`, "scope-new-screen");
  await A.context.setOffline(true);
  await type(A.page, "scope-new-title", `Offline BOQ ${STAMP}`);
  await type(A.page, "scope-new-0-description", `Brick partition ${STAMP}`);
  await type(A.page, "scope-new-0-unit", "sqm");
  await type(A.page, "scope-new-0-quantity", "100");
  await type(A.page, "scope-new-0-rate", "50");
  await type(A.page, "scope-new-0-itemCode", "A1");
  await A.page.getByTestId("scope-new-save").click();
  await expect(A.page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, P, "boqs", `Offline BOQ ${STAMP}`)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  const lines = await serverRows(A.context, P, "boq_lines", `Brick partition ${STAMP}`);
  expect(lines.length).toBe(1);
  expect(JSON.stringify(lines[0].data)).toContain("A1");
  boqServerId = String((await serverRows(A.context, P, "boqs", `Offline BOQ ${STAMP}`))[0].id);
});

test("a revision made offline (quantity up) reaches the server", async () => {
  expect(boqServerId).not.toBe("");
  await expect.poll(async () => { await A.page.evaluate(() => window.dispatchEvent(new Event("online"))); return (await serverRows(A.context, P, "boqs", `Offline BOQ ${STAMP}`)).length; }, { timeout: 240_000 }).toBeGreaterThan(0);
  // the laptop must have PULLED its own new BOQ back before it can be revised (the server has it already): a person opens the BOQ list (that opens the pull); measured and recorded, never assumed
  const t0 = Date.now();
  await expect
    .poll(async () => { await A.page.goto(`/local/scope?projectId=${P}`); await A.page.waitForTimeout(8_000); return (await localRows(A.page, "boqs", `Offline BOQ ${STAMP}`)).filter((r) => String(r.id).endsWith(boqServerId)).length; }, { timeout: 600_000, intervals: [5_000], message: "the laptop never pulled back its own new BOQ (the server's copy, by id: the laptop stores it as boqs:<id>)" })
    .toBeGreaterThan(0);
  test.info().annotations.push({ type: "own-boq-back-on-laptop", description: `${Math.round((Date.now() - t0) / 1000)}s after the server had it` });
  // the BOQ row and its LINES arrive separately: open the revise screen like a person would, again and again, until it shows the form (data-state=ready) and not "not in the copy on this laptop"
  await expect
    .poll(async () => { await A.page.goto(`/local/scope/${boqServerId}/revise?projectId=${P}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("scope-revise-screen").getAttribute("data-state"); }, { timeout: 600_000, intervals: [4_000], message: "the revise screen never got the BOQ lines from the laptop copy" })
    .toBe("ready");
  await A.context.setOffline(true);
  const qty = A.page.getByLabel("Qty, line 1");
  await qty.click();
  await qty.fill("");
  await qty.pressSequentially("120", { delay: 15 });
  await expect(A.page.getByTestId("scope-revise-variation-amount")).toContainText("1,000");
  await A.page.getByTestId("scope-revise-save").click();
  await expect(A.page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect
    .poll(async () => (await serverRows(A.context, P, "boq_lines", `Brick partition ${STAMP}`)).some((r) => JSON.stringify(r.data).includes("120")), { timeout: 240_000, message: "the revised quantity never reached the server" })
    .toBe(true);
});

test("a milestone made offline reaches the server", async () => {
  await openForm(A.page, `/local/schedule/milestones/new?projectId=${P}`, "milestone-form");
  await A.context.setOffline(true);
  await A.page.getByLabel("Title").fill(`Offline milestone ${STAMP}`);
  await A.page.getByLabel("Target date").fill("2026-12-15");
  await A.page.getByLabel("Description").fill("Level 1 handover");
  await A.page.getByRole("button", { name: "Save milestone" }).click();
  await expect(A.page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, P, "milestones", `Offline milestone ${STAMP}`)).length, { timeout: 240_000 }).toBeGreaterThan(0);
});

test("a site instruction made offline reaches the server (the server gives it its number)", async () => {
  await openForm(A.page, `/local/site-instructions/new?projectId=${P}`, "si-form");
  await A.context.setOffline(true);
  await A.page.getByLabel("To contractor").fill("Ramesh Interiors");
  await A.page.getByLabel("Instruction").fill(`Raise partition wall at grid C4 by 150mm ${STAMP}`);
  await A.page.getByLabel("Drawing reference").fill("GF-101 rev B");
  await A.page.getByRole("button", { name: "Save instruction" }).click();
  await expect(A.page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, P, "site_instructions", STAMP)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  const row = (await serverRows(A.context, P, "site_instructions", STAMP))[0];
  expect(JSON.stringify(row.data)).toMatch(/GF-101 rev B/);
  expect(JSON.stringify(row.data)).toMatch(/"(si_number|siNumber|number)":\s*\d+/);
});

test("every report kept on the laptop opens with no network", async () => {
  await A.page.goto(`/local/reports?projectId=${P}`);
  await A.page.getByRole("button", { name: /Keep all reports on this laptop/i }).click();
  await expect(A.page.getByText("Every report is now saved here and opens offline.")).toBeVisible({ timeout: 300_000 });
  const saved = await A.page.getByText("Saved here").count();
  expect(saved, "at least ten reports are saved on the laptop").toBeGreaterThanOrEqual(10);
  await A.context.setOffline(true);
  for (const name of ["Project Status", "Scope (BOQ)", "KPI"]) {
    await A.page.goto(`/local/reports?projectId=${P}`);
    await A.page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name, exact: true }).click();
    // the report list itself names the one report that cannot be kept (weekly: needs a week), so judge only the report AREA: the page without its list of reports
    await expect.poll(async () => A.page.evaluate(() => { const m = document.querySelector("main")?.cloneNode(true) as HTMLElement | undefined; m?.querySelectorAll("nav").forEach((n) => n.remove()); return m?.innerText ?? ""; }), { timeout: 30_000 }).not.toMatch(/needs a connection|not saved|could not be opened/i);
    await expect(A.page.getByRole("heading").first()).toBeVisible();
  }
  await A.context.setOffline(false);
});
