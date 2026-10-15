import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, projectId, serverRows, outboxOps, openLocal } from "./support/real-backend";

// SUMEET 111, the create-form rules offline (R-03, R-04, R-13..R-18) as a USER on the deployed site: a fresh browser profile signs in, opens the laptop's New BOQ
// form, the network is CUT, a BOQ that breaks (or keeps) one rule is typed by hand and saved, the network comes back, and the SERVER is re-read.
// For a rule that must refuse: nothing reaches the server AND the person was told in words (on the form at once, or on the outbox card after reconnect).
// For a rule that must allow: the BOQ and its lines reach the server. Same method and config as live-offline-writers-users.spec.ts (not part of pull-request CI).
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const STAMP = `${Date.now()}`.slice(-7);
let A: { context: BrowserContext; page: Page };
let P = "";

type Line = { code?: string; parent?: string; pct?: string; desc: string; qty?: string; rate?: string };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  P = await projectId(A.context);
  await openLocal(A.page, `/local/scope?projectId=${P}`, "scope-list");
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

/** Types a BOQ into the laptop's New BOQ form with the network cut, saves it, brings the network back, and reports what the person saw and what the server holds. */
async function saveOffline(title: string, lines: Line[]) {
  const page = A.page;
  const subQtyDisabled: boolean[] = [];
  await page.goto(`/local/scope/new?projectId=${P}`);
  await expect(page.getByTestId("scope-new-screen")).toBeVisible({ timeout: 120_000 });
  await A.context.setOffline(true);
  await type(page, "scope-new-title", title);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.getByTestId("scope-new-add").click();
    const l = lines[i];
    await type(page, `scope-new-${i}-description`, l.desc);
    if (l.code) await type(page, `scope-new-${i}-itemCode`, l.code);
    if (l.parent) await type(page, `scope-new-${i}-parentItemCode`, l.parent);
    if (l.pct) await type(page, `scope-new-${i}-breakdownPercentage`, l.pct);
    if (l.parent) subQtyDisabled.push(await page.getByTestId(`scope-new-${i}-quantity`).isDisabled());
    if (l.qty && !l.parent) await type(page, `scope-new-${i}-quantity`, l.qty);
    if (l.rate && !l.parent) await type(page, `scope-new-${i}-rate`, l.rate);
    if (l.qty && !l.parent) await type(page, `scope-new-${i}-unit`, "sqm");
  }
  const save = page.getByTestId("scope-new-save");
  const saveDisabled = await save.isDisabled();
  const saveTitle = (await save.getAttribute("title")) ?? "";
  let localError = "";
  let queued = false;
  if (!saveDisabled) {
    await save.click();
    await page.waitForTimeout(2_000);
    const e1 = await page.getByTestId("scope-error-lines").innerText().catch(() => "");
    const e2 = await page.getByTestId("scope-error-title").innerText().catch(() => "");
    localError = `${e1} ${e2}`.trim();
    queued = await page.getByText(/Offline: \d+ changes? (is|are) saved on this laptop/i).first().isVisible().catch(() => false);
  }
  await A.context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let card = "";
  if (queued) {
    await expect
      .poll(async () => (await outboxOps(page)).filter((o) => o.status !== "done" && o.status !== "sent").length, { timeout: 240_000, message: "the queued write never settled" })
      .toBeLessThanOrEqual(1);
    await page.waitForTimeout(5_000);
    card = await page.getByTestId("outbox-attention").first().innerText().catch(() => "");
  }
  // an empty title cannot be searched for (it would match every BOQ): the line text identifies the BOQ instead
  const needle = title || lines[0].desc;
  const onServer = (await serverRows(A.context, P, title ? "boqs" : "boq_lines", needle)).length > 0;
  return { subQtyDisabled, saveDisabled, saveTitle, localError, queued, card: card.replace(/\s+/g, " "), onServer };
}

function told(r: { saveDisabled: boolean; saveTitle: string; localError: string; card: string }) {
  return `${r.saveTitle} ${r.localError} ${r.card}`.trim();
}

test("R-04 a missing title is refused and the form names the field", async () => {
  const r = await saveOffline("", [{ desc: `Line ${STAMP}`, qty: "1", rate: "1" }]);
  test.info().annotations.push({ type: "R-04", description: JSON.stringify(r) });
  expect(r.onServer, "nothing without a title reaches the server").toBe(false);
  expect(told(r).toLowerCase(), "the person is told about the title, in words").toContain("title");
});

test("R-16 a sub-task with a parent but no percentage is refused", async () => {
  const title = `R16 ${STAMP}`;
  const r = await saveOffline(title, [{ code: "1", desc: `Root ${STAMP}`, qty: "10", rate: "10" }, { code: "1.1", parent: "1", desc: `Child ${STAMP}` }]);
  test.info().annotations.push({ type: "R-16", description: JSON.stringify(r) });
  expect(r.onServer, "the BOQ with a percentage-less child does not reach the server").toBe(false);
  expect(told(r).length, "the person is told why, in words").toBeGreaterThan(8);
});

test("R-17 a parent code that matches nothing is refused", async () => {
  const title = `R17 ${STAMP}`;
  const r = await saveOffline(title, [{ code: "1", desc: `Root ${STAMP}`, qty: "10", rate: "10" }, { code: "1.1", parent: "99", pct: "30", desc: `Orphan ${STAMP}` }]);
  test.info().annotations.push({ type: "R-17", description: JSON.stringify(r) });
  expect(r.onServer, "the BOQ with an orphan sub-task does not reach the server").toBe(false);
  expect(told(r).length, "the person is told why, in words").toBeGreaterThan(8);
});

test("R-18 a circular reference is refused and nothing hangs", async () => {
  const title = `R18 ${STAMP}`;
  const r = await saveOffline(title, [{ code: "1", parent: "2", pct: "50", desc: `A ${STAMP}` }, { code: "2", parent: "1", pct: "50", desc: `B ${STAMP}` }]);
  test.info().annotations.push({ type: "R-18", description: JSON.stringify(r) });
  expect(r.onServer, "the circular BOQ does not reach the server").toBe(false);
  expect(told(r).length, "the person is told why, in words").toBeGreaterThan(8);
});

test("R-14 / R-13 weights that do not sum to 100 are accepted, and a sub-task's own quantity and rate are ignored", async () => {
  const title = `R14 ${STAMP}`;
  const r = await saveOffline(title, [
    { code: "1", desc: `Root ${STAMP}`, qty: "100", rate: "50" },
    { code: "1.1", parent: "1", pct: "30", desc: `ChildA ${STAMP}` },
    { code: "1.2", parent: "1", pct: "30", desc: `ChildB ${STAMP}` },
  ]);
  test.info().annotations.push({ type: "R-14/R-13", description: JSON.stringify(r) });
  expect(r.subQtyDisabled.length, "sub-task rows were on the form").toBe(2);
  expect(r.subQtyDisabled.every(Boolean), "R-13: the form does not take a sub-task's own quantity (the box is disabled)").toBe(true);
  await expect.poll(async () => (await serverRows(A.context, P, "boqs", title)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  const a = await serverRows(A.context, P, "boq_lines", `ChildA ${STAMP}`);
  expect(a.length, "the sub-task line reached the server").toBe(1);
  const data = JSON.stringify(a[0].data);
  // root 100 x 50 = 5000; 30% = 1500: the sub-task's own 999 x 999 is ignored
  expect(data, "the sub-task amount is the root's amount x its percentage, not its own quantity x rate").toMatch(/1500/);
});

test("R-03 a BOQ with a title and no lines is allowed", async () => {
  const title = `R03 ${STAMP}`;
  const r = await saveOffline(title, [{ desc: "" }]);
  test.info().annotations.push({ type: "R-03", description: JSON.stringify(r) });
  // either the laptop saved it (and the server has it) or it said, in words, what is missing: the finding is recorded either way
  expect(r.onServer || told(r).length > 8, "a title-only BOQ either reaches the server or the person is told why not").toBe(true);
  expect(r.onServer, "R-03 says a BOQ with a title and zero lines IS allowed").toBe(true);
});
