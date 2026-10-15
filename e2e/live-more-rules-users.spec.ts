import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, openLocal, outboxOps, serverCall, serverRows } from "./support/real-backend";

// SUMEET 111, six more requirements as a USER on the deployed site (R-24, R-52, R-46, R-91, R-92, R-93), same method and config as
// live-offline-boq-rules-users.spec.ts (playwright.live-offline-users.config.ts; not part of pull-request CI). A fresh browser profile signs in as the
// documented E2E finance person; writes are typed by hand with the network CUT (or online for the cold-start rule), and each outcome is re-read from the
// SERVER's own rows, never from a toast (R74-RULING-03).
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const STAMP = `${Date.now()}`.slice(-7);
const VILLA = "Villa Fit-Out (Manual Demo)";
let A: { context: BrowserContext; page: Page };
let V = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  V = manifest.projects.find((x) => x.name === VILLA)!.id;
  expect(V, "the E2E organisation has the Villa project").toBeTruthy();
  await openLocal(A.page, `/local/scope?projectId=${V}`, "scope-list");
});
test.afterAll(async () => {
  await A?.context.close();
});

async function type(page: Page, testId: string, text: string) {
  const box = page.getByTestId(testId);
  await box.click();
  await box.fill("");
  await box.pressSequentially(text, { delay: 10 });
}

async function reconnect(page: Page, context: BrowserContext) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await outboxOps(page)).filter((o) => o.status !== "done" && o.status !== "sent").length, { timeout: 240_000, message: "the queued write was never sent" }).toBe(0);
}

test("R-24 / R-52: a percentage-only change is a variation; after the revision only the latest revision stands", async () => {
  const title = `RV ${STAMP}`;
  // 1. a BOQ with a root (100 x 50 = 5000) and a sub-task at 30% (1500), typed with the network cut
  await A.page.goto(`/local/scope/new?projectId=${V}`);
  await expect(A.page.getByTestId("scope-new-screen")).toBeVisible({ timeout: 120_000 });
  await A.context.setOffline(true);
  await type(A.page, "scope-new-title", title);
  await type(A.page, "scope-new-0-description", `RV root ${STAMP}`);
  await type(A.page, "scope-new-0-itemCode", "1");
  await type(A.page, "scope-new-0-unit", "sqm");
  await type(A.page, "scope-new-0-quantity", "100");
  await type(A.page, "scope-new-0-rate", "50");
  await A.page.getByTestId("scope-new-add").click();
  await type(A.page, "scope-new-1-description", `RV child ${STAMP}`);
  await type(A.page, "scope-new-1-itemCode", "1.1");
  await type(A.page, "scope-new-1-parentItemCode", "1");
  await type(A.page, "scope-new-1-breakdownPercentage", "30");
  await A.page.getByTestId("scope-new-save").click();
  await expect(A.page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  await expect.poll(async () => (await serverRows(A.context, V, "boqs", title)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  const boqId = String((await serverRows(A.context, V, "boqs", title))[0].id);
  // 2. the laptop pulls its own BOQ back, then the revise screen is opened (again and again until it shows the form)
  await expect
    .poll(async () => { await A.page.goto(`/local/scope/${boqId}/revise?projectId=${V}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("scope-revise-screen").getAttribute("data-state"); }, { timeout: 600_000, intervals: [4_000], message: "the revise screen never showed the form" })
    .toBe("ready");
  // 3. offline, ONLY the sub-task's percentage changes 30 -> 40: nothing else is touched
  await A.context.setOffline(true);
  await type(A.page, "scope-revise-1-breakdownPercentage", "40");
  await expect(A.page.getByTestId("scope-revise-variation-amount"), "R-24: a percentage-only change shows as a variation of 500 (1500 -> 2000)").toContainText("500");
  await A.page.getByTestId("scope-revise-save").click();
  await expect(A.page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first()).toBeVisible({ timeout: 30_000 });
  await reconnect(A.page, A.context);
  // 4. the SERVER: a second revision exists, its sub-task is priced at 40% (2000), and the first revision is superseded (only the latest stands, R-52)
  await expect
    .poll(async () => (await serverRows(A.context, V, "boq_lines", `RV child ${STAMP}`)).some((r) => JSON.stringify(r.data).includes("2000")), { timeout: 240_000, message: "the revised percentage never reached the server" })
    .toBe(true);
  const boqs = await serverRows(A.context, V, "boqs", title);
  test.info().annotations.push({ type: "R-52", description: JSON.stringify(boqs.map((b) => b.data)).slice(0, 600) });
  expect(boqs.length, "two revisions of the BOQ exist").toBe(2);
  const live = boqs.filter((b) => !/superseded/i.test(JSON.stringify(b.data)));
  expect(live.length, "exactly ONE revision is not superseded: only the latest is counted").toBe(1);
});

test("R-46: progress recorded twice keeps both entries and adds them once (no double count)", async () => {
  // the sub-task line of the BOQ revised in test 1: two entries of 2 and 3 are typed offline, sent once, and both are stored once each
  const readEntries = async () => (await serverRows(A.context, V, "progress", "")).map((r) => r.data as Record<string, unknown>);
  const before = await readEntries();
  await expect
    .poll(async () => { await A.page.goto(`/local/work-progress?projectId=${V}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("work-progress-form").count(); }, { timeout: 900_000, intervals: [5_000], message: "the progress form was never offered" })
    .toBeGreaterThan(0);
  await A.context.setOffline(true);
  const entry = async (qty: string) => {
    if (await A.page.getByLabel("Activity").count()) await A.page.getByLabel("Activity").selectOption({ index: 1 });
    const options = await A.page.getByLabel("BOQ line").locator("option").allInnerTexts();
    // progress goes on a CHILD line (a parent line's figure is derived, never entered): the sub-task of the BOQ test 1 revised, newest copy
    const i = options.map((o, k) => (o.includes(`RV child ${STAMP}`) ? k : -1)).filter((k) => k > -1).pop() ?? -1;
    expect(i, "the sub-task line is offered").toBeGreaterThan(-1);
    await A.page.getByLabel("BOQ line").selectOption({ index: i });
    await A.page.getByRole("radio", { name: /^Quantity/ }).check();
    await A.page.getByRole("textbox", { name: "Quantity done" }).fill(qty);
    await A.page.getByLabel("Remarks").fill(`twice ${STAMP}`);
    await A.page.getByRole("button", { name: "Save entry" }).click();
    await expect(A.page.getByTestId("save-note")).toHaveAttribute("data-ok", "1", { timeout: 30_000 });
  };
  await entry("2");
  await entry("3");
  await reconnect(A.page, A.context);
  // a second "online" signal must not send anything again
  await A.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await A.page.waitForTimeout(8_000);
  await expect.poll(async () => (await serverRows(A.context, V, "progress", `twice ${STAMP}`)).length, { timeout: 240_000, message: "the entries never reached the server" }).toBe(2);
  const mine = await serverRows(A.context, V, "progress", `twice ${STAMP}`);
  const qtys = mine.map((r) => Number((r.data as Record<string, unknown>).quantityDone ?? (r.data as Record<string, unknown>).quantity_done)).sort();
  expect(qtys, "history kept: both entries stored as typed, once each").toEqual([2, 3]);
  const after = await readEntries();
  expect(after.length - before.length, "exactly two new entries, no duplicates").toBe(2);
});

test("R-91: the first submit from a brand-new browser profile on the live site works (no 'Failed to fetch')", async ({ browser }) => {
  const fresh = await openLaptop(browser, "finance");
  const failures: string[] = [];
  fresh.page.on("console", (m) => { if (/failed to fetch/i.test(m.text())) failures.push(m.text()); });
  fresh.page.on("pageerror", (e) => { if (/failed to fetch/i.test(String(e))) failures.push(String(e)); });
  try {
    const title = `COLD ${STAMP}`;
    await fresh.page.goto(`/local/scope/new?projectId=${V}`);
    await expect(fresh.page.getByTestId("scope-new-screen")).toBeVisible({ timeout: 120_000 });
    await type(fresh.page, "scope-new-title", title);
    await type(fresh.page, "scope-new-0-description", `Cold line ${STAMP}`);
    await type(fresh.page, "scope-new-0-unit", "nos");
    await type(fresh.page, "scope-new-0-quantity", "1");
    await type(fresh.page, "scope-new-0-rate", "1");
    await fresh.page.getByTestId("scope-new-save").click(); // the very first submit, online, on a cold profile
    await expect.poll(async () => (await serverRows(fresh.context, V, "boqs", title)).length, { timeout: 240_000, message: "the first submit never reached the server" }).toBeGreaterThan(0);
    expect(await fresh.page.getByText(/failed to fetch/i).count(), "no 'Failed to fetch' on the page").toBe(0);
    expect(failures, "no 'Failed to fetch' in the console").toEqual([]);
  } finally {
    await fresh.context.close();
  }
});

test("R-92: the left rail and the right pane stay in sync both ways, driven by the menu itself", async () => {
  await A.page.goto(`/dashboard?projectId=${V}`);
  const nav = A.page.getByRole("navigation", { name: "Modules" });
  await expect(nav).toBeVisible({ timeout: 120_000 });
  const hrefs = (await nav.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))).map((h) => h.split("?")[0]).filter((h) => h.startsWith("/"));
  expect(hrefs.length, "the menu has modules").toBeGreaterThan(5);
  // (1) left to right: pressing a left-rail module opens the matching screen and the rail marks it
  for (const href of hrefs.slice(0, 6)) {
    await nav.locator(`a[href^="${href}"]`).first().click();
    await expect(A.page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|/|$)`), { timeout: 60_000 });
    await expect(nav.locator('a[aria-current="page"]'), `the rail marks ${href}`).toHaveCount(1);
    expect(await nav.locator('a[aria-current="page"]').first().getAttribute("href")).toContain(href);
  }
  // (2) right to left: going to a screen by address (not the rail) moves the rail's mark
  for (const href of hrefs.slice(6, 10)) {
    await A.page.goto(`${href}?projectId=${V}`);
    await expect(nav).toBeVisible({ timeout: 60_000 });
    await expect(nav.locator('a[aria-current="page"]').first(), `the rail follows to ${href}`).toHaveAttribute("href", new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("R-93: the BOQ tracks contract and project value as two pairs (quantity and price each), side by side", async () => {
  const boqs = (await serverRows(A.context, V, "boqs", "")).filter((r) => /"approved"/.test(JSON.stringify(r.data)));
  expect(boqs.length).toBeGreaterThan(0);
  const boqId = String(boqs[boqs.length - 1].id);
  const lines = (await serverRows(A.context, V, "boq_lines", boqId)).map((r) => r.data as Record<string, unknown>);
  const first = lines.find((l) => String(l.description ?? ""))!;
  const desc = String(first.description);
  await A.page.goto(`/scope/${boqId}?projectId=${V}`);
  await expect(A.page.getByTestId("boq-dual-view-grid")).toBeVisible({ timeout: 120_000 });
  await expect(A.page.getByRole("columnheader", { name: "Project (cost)" })).toBeVisible();
  await expect(A.page.getByRole("columnheader", { name: "Contract (customer)" })).toBeVisible();
  for (const field of ["qtyProject", "rateProject", "qtyContract", "rateContract"]) {
    await expect(A.page.getByLabel(`${field} for ${desc}`), `${field} is a cell of its own`).toBeVisible();
  }
  // the project-side quantity shown equals the quantity the server holds for that line
  const qtyServer = Number(first.quantity ?? first.qty);
  if (Number.isFinite(qtyServer)) {
    expect(Number(await A.page.getByLabel(`qtyProject for ${desc}`).inputValue()), "project quantity equals the server's").toBe(qtyServer);
  }
});
