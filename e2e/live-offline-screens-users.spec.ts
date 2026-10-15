import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, serverCall, serverRows } from "./support/real-backend";

// SUMEET 111, the offline SCREENS as a user sees them, on the deployed site: a fresh laptop (browser profile) signs in as a documented E2E person, the project's data
// is copied, the network is CUT, and each screen is read like a person reads it (text on the page), then compared with what the SERVER holds. Same method and
// config as live-offline-writers-users.spec.ts (playwright.live-offline-users.config.ts; not part of pull-request CI).
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const VILLA = "Villa Fit-Out (Manual Demo)";
let A: { context: BrowserContext; page: Page };
let V = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  V = manifest.projects.find((x) => x.name === VILLA)!.id;
  expect(V, "the E2E organisation has the Villa project").toBeTruthy();
  // the first copy of a project takes minutes: come back to its BOQ list until the laptop shows it
  await expect
    .poll(async () => { await A.page.goto(`/local/scope?projectId=${V}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("scope-list").getAttribute("data-state"); }, { timeout: 900_000, intervals: [5_000], message: "the Villa BOQ list never came onto the laptop" })
    .toBe("local");
});
test.afterAll(async () => {
  await A?.context.close();
});

/** The words on the page without the sidebar and the list of modules: what the person reads on the screen itself. */
async function screenText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = document.querySelector("main")?.cloneNode(true) as HTMLElement | undefined;
    return m?.innerText ?? "";
  });
}

test("2.20 'Save permit' with nothing typed and no file says, in words, everything that is missing (offline)", async () => {
  await A.page.goto(`/local/permits/new?projectId=${V}`);
  await expect(A.page.getByRole("button", { name: /Save permit/ })).toBeVisible({ timeout: 120_000 });
  await A.context.setOffline(true);
  await A.page.getByRole("button", { name: /Save permit/ }).click();
  const said = A.page.getByText(/file/i).filter({ hasText: /(name|number|authority|expiry)/i });
  await expect(said.first()).toBeVisible({ timeout: 15_000 });
  const text = await screenText(A.page);
  expect(text).toMatch(/name/i);
  expect(text).toMatch(/file/i);
  await A.context.setOffline(false);
});

test("2.23 one project selection: the project chosen in the header is the project every screen shows", async () => {
  await A.page.goto(`/local/scope?projectId=${V}`);
  const select = A.page.getByRole("combobox", { name: "Project" });
  await expect.poll(async () => (await select.locator("option").count()), { timeout: 60_000 }).toBeGreaterThan(2);
  const options = await select.locator("option").allInnerTexts();
  const other = options.find((o) => o !== VILLA && !o.startsWith("+") && !o.startsWith("E2E-BatchA") && !o.startsWith("LIVE-SMOKE"));
  expect(other, "there is a second project to switch to").toBeTruthy();
  await select.selectOption({ label: other! });
  for (const path of ["/local/scope", "/local/labour", "/local/materials", "/local/schedule", "/local/permits"]) {
    await A.page.goto(path);
    await expect(A.page.getByRole("combobox", { name: "Project" }).locator("option:checked")).toHaveText(other!, { timeout: 30_000 });
    await expect(A.page.locator("main h1").first()).toContainText(other!.slice(0, 12).trim(), { timeout: 30_000 });
  }
  await A.page.getByRole("combobox", { name: "Project" }).selectOption({ label: VILLA });
  await A.page.goto("/local/scope");
  await expect(A.page.locator("main h1").first()).toContainText("Villa", { timeout: 30_000 });
});

test("4.3b the offline dashboard shows the last figures the server gave, marked 'As of' a date", async () => {
  await A.page.goto(`/local/dashboard?projectId=${V}`);
  await expect(A.page.getByTestId("overview-dashboard")).toBeVisible({ timeout: 120_000 });
  // online first: the laptop keeps the server's figures when it opens the dashboard
  await expect(A.page.getByTestId("overview-dashboard-asof")).toBeVisible({ timeout: 180_000 });
  await A.context.setOffline(true);
  await A.page.goto(`/local/dashboard?projectId=${V}`);
  await expect(A.page.getByTestId("overview-dashboard-asof")).toBeVisible({ timeout: 60_000 });
  const said = await A.page.getByTestId("overview-dashboard-asof").innerText();
  expect(said).toMatch(/as of/i);
  expect(said).toMatch(/\d{2}-\d{2}-\d{4}/);
  await A.context.setOffline(false);
});

test("4.4 every money screen offline writes amounts in the organisation's currency (AED), never another symbol", async () => {
  await A.context.setOffline(true);
  const seen: Record<string, string> = {};
  for (const path of ["/local/scope", "/local/billing-milestones", "/local/change-orders", "/local/expenses", "/local/analysis/project-360", `/local/dashboard?projectId=${V}`]) {
    await A.page.goto(path.includes("projectId") ? path : `${path}?projectId=${V}`);
    await A.page.waitForTimeout(4_000);
    const text = await screenText(A.page);
    seen[path] = text;
    expect(text, `${path} shows no other currency symbol`).not.toMatch(/[₹$€£]|\bINR\b|\bUSD\b|\bRs\.?\s?\d/);
  }
  expect(Object.values(seen).some((t) => /AED\s?\d/.test(t)), "at least one money screen writes an amount with AED").toBe(true);
  await A.context.setOffline(false);
});

test("4.1b/4.2 the offline BOQ screen shows the server's own lines (description, quantity, rate) with sub-tasks indented under their parent", async () => {
  const boqs = (await serverRows(A.context, V, "boqs", "")).filter((r) => /"approved"/.test(JSON.stringify(r.data)));
  expect(boqs.length, "the Villa project has an approved BOQ").toBeGreaterThan(0);
  // prefer an approved BOQ that has sub-tasks, so indent and "% of parent" (R-30, R-31) are really compared
  let boqId = String(boqs[boqs.length - 1].id);
  let lines: Record<string, unknown>[] = [];
  const pick = (k: Record<string, unknown>, re: RegExp) => Object.entries(k).find(([name, v]) => re.test(name) && v != null && v !== "")?.[1];
  for (const b of boqs) {
    const ls = (await serverRows(A.context, V, "boq_lines", String(b.id))).map((r) => r.data as Record<string, unknown>);
    if (ls.some((l) => pick(l, /parent/i) != null && pick(l, /breakdown/i) != null)) { boqId = String(b.id); lines = ls; break; }
  }
  if (!lines.length) lines = (await serverRows(A.context, V, "boq_lines", boqId)).map((r) => r.data as Record<string, unknown>);
  expect(lines.length).toBeGreaterThan(0);
  await A.context.setOffline(true);
  await expect
    .poll(async () => { await A.page.goto(`/local/scope/${boqId}?projectId=${V}`); await A.page.waitForTimeout(3_000); return (await screenText(A.page)).includes(String(lines[0].description ?? lines[0].desc ?? "")); }, { timeout: 120_000, intervals: [3_000], message: "the offline BOQ screen never showed the server's first line" })
    .toBe(true);
  const text = await screenText(A.page);
  for (const l of lines) {
    const d = String(l.description ?? l.desc ?? "").trim();
    if (d) expect(text, `line "${d}" is on the offline screen`).toContain(d);
  }
  // R-31: every sub-task says "N% of parent" with the server's own number; R-15: its parent says what the children add up to
  const subs = lines.filter((l) => pick(l, /parent/i) != null && pick(l, /breakdown/i) != null);
  expect(subs.length, "the compared BOQ has sub-tasks (the check is not vacuous)").toBeGreaterThan(0);
  for (const l of subs) {
    const n = Number(pick(l, /breakdown/i));
    expect(text, `sub-task "${String(l.description ?? "")}" says ${n}% of parent`).toContain(`${n}% of parent`);
  }
  const sum = Math.round(subs.reduce((a, l) => a + Number(pick(l, /breakdown/i)), 0) * 100) / 100;
  expect(text, "the parent shows its children's total").toContain(`(children: ${sum}%)`);
  // indent: each sub-task row's description cell is indented (class pl-6), each root's is not
  const indented = await A.page.locator('[data-testid="boq-local-line"] td.pl-6').count();
  expect(indented, "sub-task rows are indented").toBe(subs.length);
  await A.context.setOffline(false);
});

test("4.6 and Project 360 open offline with their last result, not an empty page", async () => {
  await A.context.setOffline(true);
  for (const path of ["/local/analysis/exceptions", "/local/analysis/project-360", "/local/analysis"]) {
    await A.page.goto(`${path}?projectId=${V}`);
    await expect(A.page.locator("main h1").first()).toBeVisible({ timeout: 60_000 });
    const text = await screenText(A.page);
    expect(text.trim().length, `${path} is not empty`).toBeGreaterThan(80);
  }
  await A.context.setOffline(false);
});

test("2.19 / R-47 a progress entry that would take a line past 100% never reaches the books, and the person is told why in words (offline, then reconnect)", async () => {
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  const E = manifest.projects.find((x) => x.name === "Emerald Business Park - Phase 1")!.id;
  expect(E).toBeTruthy();
  await expect
    .poll(async () => { await A.page.goto(`/local/work-progress?projectId=${E}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("work-progress-form").count(); }, { timeout: 900_000, intervals: [5_000], message: "the progress form was never offered for Emerald" })
    .toBeGreaterThan(0);
  const stamp = Date.now();
  await A.context.setOffline(true);
  const entry = async (pct: string) => {
    if (await A.page.getByLabel("Activity").count()) await A.page.getByLabel("Activity").selectOption({ index: 1 });
    await A.page.getByLabel("BOQ line").selectOption({ index: 1 });
    // The server's 100% rule (R-47) counts QUANTITY entries (construction-progress-service.ts); a "% complete" entry carries no quantity and is not capped,
    // so this check enters quantities: two entries that together pass the line's own quantity (Emerald EBP-BOQ-001: 4,507 cum).
    await A.page.getByRole("radio", { name: /^Quantity/ }).check();
    await A.page.getByRole("textbox", { name: "Quantity done" }).fill(pct);
    await A.page.getByLabel("Remarks").fill(`cap check ${stamp}`);
    await A.page.getByRole("button", { name: "Save entry" }).click();
  };
  await entry("3000");
  await expect(A.page.getByTestId("save-note")).toHaveAttribute("data-ok", "1", { timeout: 30_000 });
  await entry("3000");
  await A.page.waitForTimeout(1_500);
  // either the laptop's own guard says why at once, or the entry is queued and the server refuses it after reconnect with its reason
  const blockedHere = (await A.page.getByTestId("save-note").getAttribute("data-ok")) === "0";
  if (blockedHere) expect(await A.page.getByTestId("save-note").innerText(), "the laptop says why in words").toMatch(/[a-z]{4,}/i);
  if (!blockedHere) {
    await A.context.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event("online")));
    const card = A.page.getByTestId("outbox-attention");
    await expect(card.first()).toBeVisible({ timeout: 240_000 });
    const said = await card.first().innerText();
    expect(said, "the card carries the server's reason, not the generic sentence").not.toMatch(/check the values and try again/i);
    expect(said).toMatch(/\d/);
  }
  await A.context.setOffline(false);
});

test("2.24 / R-47 a '% complete' entry that would take a line past 100% is refused by the server with its reason (offline, then reconnect)", async () => {
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  const E = manifest.projects.find((x) => x.name === "Emerald Business Park - Phase 1")!.id;
  expect(E).toBeTruthy();
  await expect
    .poll(async () => { await A.page.goto(`/local/work-progress?projectId=${E}`); await A.page.waitForTimeout(6_000); return A.page.getByTestId("work-progress-form").count(); }, { timeout: 900_000, intervals: [5_000], message: "the progress form was never offered for Emerald" })
    .toBeGreaterThan(0);
  const stamp = Date.now();
  await A.context.setOffline(true);
  if (await A.page.getByLabel("Activity").count()) await A.page.getByLabel("Activity").selectOption({ index: 1 });
  await A.page.getByLabel("BOQ line").selectOption({ index: 1 });
  await A.page.getByRole("radio", { name: /^% complete/ }).check();
  await A.page.getByRole("textbox", { name: "% complete" }).fill("60");
  await A.page.getByLabel("Remarks").fill(`pct cap check ${stamp}`);
  await A.page.getByRole("button", { name: "Save entry" }).click();
  await A.page.waitForTimeout(1_500);
  const blockedHere = (await A.page.getByTestId("save-note").getAttribute("data-ok")) === "0";
  if (blockedHere) expect(await A.page.getByTestId("save-note").innerText(), "the laptop says why in words").toMatch(/[a-z]{4,}/i);
  else {
    await A.context.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event("online")));
    const card = A.page.getByTestId("outbox-attention");
    await expect(card.first(), "the server refused the percent entry and the laptop shows it").toBeVisible({ timeout: 240_000 });
    const said = await card.first().innerText();
    expect(said).not.toMatch(/check the values and try again/i);
    expect(said, "the reason names the 100% limit").toMatch(/100|%|left/i);
    expect(said).toMatch(/\d/);
  }
  await A.context.setOffline(false);
});

test("2.22 / F60 the laptop's copy refreshes: 'last copied' moves on while the person works, it does not stay at the time of the first copy", async () => {
  const note = A.page.getByTestId("scope-list-copy-note");
  await A.page.goto(`/local/scope?projectId=${V}`);
  await expect(note).toContainText(/last copied/i, { timeout: 120_000 });
  const before = (await note.innerText()).trim();
  // a person keeps working online for a while: the laptop checks the server's change feed again and again
  await expect
    .poll(async () => { await A.page.evaluate(() => window.dispatchEvent(new Event("online"))); await A.page.waitForTimeout(20_000); await A.page.goto(`/local/scope?projectId=${V}`); return (await A.page.getByTestId("scope-list-copy-note").innerText()).trim(); }, { timeout: 600_000, intervals: [1_000], message: "'last copied' never moved from the time of the first copy" })
    .not.toBe(before);
});
