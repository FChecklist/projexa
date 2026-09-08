import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// R81 D6-03. The seven /scope-screen requirements that were BLOCKED only
// because their recorded route pointed at https://projexa-ai.com (paused,
// 503 DEPLOYMENT_PAUSED). Environment 1 (local + Supabase) is live, so this
// re-tests every one of them against http://localhost:3100.
//
// NOTHING HERE WRITES. R-90/R-91 deliberately never complete a real BOQ
// create: /api/scope's POST forwards straight to VERIDIAN without local
// validation, so a "deliberately invalid" submit could still reach the
// upstream writer. The two cases below instead (a) intercept the POST at the
// network boundary and hand the client a real backend-shaped error body, and
// (b) exercise the cold route with a body the PROXY ITSELF rejects before
// callVeridian is ever reached ("Request body must be valid JSON", route.ts).
test.use({ storageState: "playwright/.auth/ceo.json" });

const P = DEFAULT_PROJECT.id;

// KD-15. The local dev server compiles a route on its FIRST hit, and the
// authenticated /api/scope proxy additionally waits on the local VERIDIAN
// (http://localhost:3000). Both were observed exceeding playwright.config's
// 30 s navigationTimeout / 15 s actionTimeout on a cold route while the very
// same URL loaded fine seconds later. Warm, then retry -- never conclude
// "broken" from a first-hit timeout.
async function warmGoto(page: import("@playwright/test").Page, url: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      return;
    } catch (e) {
      console.log(`R81_D603_WARM attempt ${attempt} for ${url} failed: ${e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : String(e)}`);
      if (attempt === 3) throw e;
      await page.waitForTimeout(3000);
    }
  }
}

async function slowGet(page: import("@playwright/test").Page, path: string) {
  let last: import("@playwright/test").APIResponse | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      last = await page.request.get(path, { timeout: 120_000 });
      if (last.ok()) return last;
      console.log(`R81_D603_SLOWGET ${path} attempt ${attempt} => ${last.status()} ${(await last.text()).slice(0, 200)}`);
    } catch (e) {
      console.log(`R81_D603_SLOWGET ${path} attempt ${attempt} threw ${e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : String(e)}`);
    }
    await page.waitForTimeout(2000);
  }
  if (!last) throw new Error(`GET ${path} never returned a response`);
  return last;
}

// ---------------------------------------------------------------------------
// R-11  Sub-task enterable in create form (Item Code / Parent Item Code /
//       Breakdown %)
// TRUE when: all three controls exist on the New BOQ line grid, are editable,
// and hold what was typed.
// ---------------------------------------------------------------------------
test("R-11 sub-task fields (Item code / Parent code / Breakdown %) are enterable", async ({ page }) => {
  await warmGoto(page, `/scope/new?projectId=${P}`);

  const itemCode1 = page.getByLabel("Item code, line 1");
  const parentCode1 = page.getByLabel("Parent code, line 1");
  const pct1 = page.getByLabel("Breakdown %, line 1");
  await expect(itemCode1).toBeVisible({ timeout: 30_000 });
  await expect(parentCode1).toBeVisible();
  await expect(pct1).toBeVisible();

  // Add a second line so a real parent/child pair exists.
  await page.getByRole("button", { name: "+ Add Line" }).click();

  await page.getByLabel("Description, line 1").fill("Excavation to reduced level");
  await itemCode1.fill("A-10");

  await page.getByLabel("Description, line 2").fill("Excavation - soft strata");
  await page.getByLabel("Item code, line 2").fill("A-10.1");
  await page.getByLabel("Parent code, line 2").fill("A-10");
  await page.getByLabel("Breakdown %, line 2").fill("40");

  // Re-read from the DOM: the values must have been accepted, not swallowed.
  expect(await itemCode1.inputValue()).toBe("A-10");
  expect(await page.getByLabel("Item code, line 2").inputValue()).toBe("A-10.1");
  expect(await page.getByLabel("Parent code, line 2").inputValue()).toBe("A-10");
  expect(await page.getByLabel("Breakdown %, line 2").inputValue()).toBe("40");

  console.log(
    `R81_D603_R11 itemCode1=A-10 line2={code:A-10.1,parent:A-10,pct:40} all three controls present+editable`
  );
});

// ---------------------------------------------------------------------------
// R-15  Running total of child percentages shown per parent
// TRUE when: after entering two children of one parent, the PARENT row shows
// the sum of its children's Breakdown % (and it changes when a child does).
// ---------------------------------------------------------------------------
test("R-15 the parent row shows a running total of its children's Breakdown %", async ({ page }) => {
  await warmGoto(page, `/scope/new?projectId=${P}`);
  await expect(page.getByLabel("Item code, line 1")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "+ Add Line" }).click();
  await page.getByRole("button", { name: "+ Add Line" }).click();

  await page.getByLabel("Description, line 1").fill("Excavation to reduced level");
  await page.getByLabel("Item code, line 1").fill("A-10");

  await page.getByLabel("Description, line 2").fill("Soft strata");
  await page.getByLabel("Item code, line 2").fill("A-10.1");
  await page.getByLabel("Parent code, line 2").fill("A-10");
  await page.getByLabel("Breakdown %, line 2").fill("40");

  await page.getByLabel("Description, line 3").fill("Hard strata");
  await page.getByLabel("Item code, line 3").fill("A-10.2");
  await page.getByLabel("Parent code, line 3").fill("A-10");
  await page.getByLabel("Breakdown %, line 3").fill("35");

  // The running total lives in the parent's own Breakdown % cell.
  const parentRow = page.getByRole("row").filter({ has: page.getByLabel("Item code, line 1") });
  await expect(parentRow.getByText("75% total")).toBeVisible({ timeout: 15_000 });
  const at75 = (await parentRow.textContent()) ?? "";

  // It is a RUNNING total, not a one-shot render: change a child, re-read.
  await page.getByLabel("Breakdown %, line 3").fill("60");
  await expect(parentRow.getByText("100% total")).toBeVisible({ timeout: 15_000 });

  console.log(`R81_D603_R15 40+35 => "75% total"; then 40+60 => "100% total" (parent row text was: ${at75.slice(0, 120)})`);
});

// ---------------------------------------------------------------------------
// R-30  Sumeet can SEE line items of a BOQ
// R-31  Sub-task rows indented and labelled % of parent
// R-60  BOQ amounts show AED not rupee
// TRUE when: opening a real BOQ renders its line items with real content;
// child rows are visually indented AND carry a "% of parent" label; and money
// on the screen is AED with no rupee symbol anywhere.
// ---------------------------------------------------------------------------
test("R-30/R-31/R-60 a real BOQ's line items are visible, indented, and priced in AED", async ({ page }) => {
  const listJson = await slowGet(page, `/api/scope?projectId=${P}`);
  expect(listJson.ok(), `GET /api/scope => ${listJson.status()}`).toBeTruthy();
  const list = (await listJson.json()) as { boqs?: Array<{ id: string; title?: string }> } | Array<{ id: string; title?: string }>;
  const boqs = Array.isArray(list) ? list : (list.boqs ?? []);
  console.log(`R81_D603_BOQ_LIST count=${boqs.length} first=${JSON.stringify(boqs[0] ?? null).slice(0, 200)}`);
  expect(boqs.length, "the seeded project must have at least one BOQ to look at").toBeGreaterThan(0);

  // Prefer a BOQ that actually has sub-tasks, so R-31 is tested on real data
  // rather than on a flat BOQ that could never show indentation.
  let chosen = boqs[0].id;
  let chosenHasSub = false;
  for (const b of boqs.slice(0, 6)) {
    const d = await page.request.get(`/api/scope/${b.id}`, { timeout: 120_000 }).catch(() => null);
    if (!d) continue;
    if (!d.ok()) continue;
    const body = (await d.json()) as { lineItems?: Array<{ parentLineItemId?: string | null }> };
    const rows = body.lineItems ?? [];
    if (rows.some((r) => r.parentLineItemId)) {
      chosen = b.id;
      chosenHasSub = true;
      break;
    }
  }
  console.log(`R81_D603_BOQ_CHOSEN id=${chosen} hasSubTasks=${chosenHasSub}`);

  await warmGoto(page, `/scope/${chosen}?projectId=${P}`);

  // --- R-30: real line-item CONTENT, not an empty table shell.
  const rows = page.getByRole("row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => rows.count(), { message: "the BOQ detail screen never rendered line-item rows", timeout: 30_000 })
    .toBeGreaterThan(1);
  const rowCount = await rows.count();
  const bodyText = (await page.locator("body").innerText()).trim();
  // Assert on content: at least one row carries a non-empty description.
  const firstDataRowText = ((await rows.nth(1).textContent()) ?? "").trim();
  expect(firstDataRowText.length, "the first line-item row rendered no text at all").toBeGreaterThan(0);
  console.log(`R81_D603_R30 rows=${rowCount} firstDataRow="${firstDataRowText.slice(0, 160)}"`);

  // --- R-60: AED, never a rupee.
  expect(bodyText, "no rupee symbol may appear on a BOQ screen").not.toContain("₹");
  expect(bodyText, "no 'Rs.' may appear on a BOQ screen").not.toMatch(/\bRs\.?\s?\d/);
  expect(bodyText, "BOQ money must be labelled AED").toContain("AED");
  const aedSamples = (bodyText.match(/AED[^\n]{0,24}/g) ?? []).slice(0, 4);
  console.log(`R81_D603_R60 rupee=absent AED_samples=${JSON.stringify(aedSamples)}`);

  // --- R-31: sub-task rows indented AND labelled "% of parent".
  if (chosenHasSub) {
    const indented = page.locator("td.pl-8, td[class*='pl-8']");
    const indentedCount = await indented.count();
    const pctOfParent = page.getByText(/% of parent/);
    const pctCount = await pctOfParent.count();
    const sample = pctCount > 0 ? ((await pctOfParent.first().textContent()) ?? "").trim() : "";
    console.log(`R81_D603_R31 indentedCells=${indentedCount} pctOfParentLabels=${pctCount} sample="${sample}"`);
    expect(indentedCount, "sub-task rows must be indented").toBeGreaterThan(0);
    expect(pctCount, "sub-task rows must be labelled '% of parent'").toBeGreaterThan(0);
  } else {
    // Do NOT silently pass. If the seeded data has no sub-task anywhere the
    // requirement cannot be observed on real data and must say so.
    throw new Error(
      `R-31 NOT OBSERVABLE: none of the ${Math.min(boqs.length, 6)} BOQs inspected in project ${P} contains a line item with parentLineItemId, so no sub-task row exists to indent.`
    );
  }
});

// ---------------------------------------------------------------------------
// R-90  Real backend message shown in the toast
// TRUE when: the words the SERVER sent back are what the user reads after a
// refused save -- not a generic "something went wrong".
// The 400 body below is injected at the network boundary because a genuinely
// refused create cannot be produced without risking an upstream write.
// ---------------------------------------------------------------------------
test("R-90 the server's own refusal wording is what the user reads", async ({ page }) => {
  const BACKEND_MSG = "R81-D603 backend refusal: line 2 references parent code A-99 which is not in this BOQ.";

  await page.route("**/api/scope", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: BACKEND_MSG }) });
  });

  await warmGoto(page, `/scope/new?projectId=${P}`);
  await expect(page.getByLabel("Item code, line 1")).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Title").fill("R81 D6-03 refusal probe");
  await page.getByLabel("Description, line 1").fill("Excavation to reduced level");
  await page.getByLabel("Unit, line 1").fill("m3");
  await page.getByLabel("Qty, line 1").fill("10");
  await page.getByLabel("Rate, line 1").fill("25");

  const saveBtn = page.getByRole("button", { name: /^Save/ });
  await expect(saveBtn).toBeEnabled({ timeout: 15_000 });
  await saveBtn.click();

  // The server's exact sentence must be on screen.
  await expect(page.getByText(BACKEND_MSG, { exact: false })).toBeVisible({ timeout: 30_000 });

  const toastCount = await page.locator("[data-sonner-toast]").count();
  const toastText = toastCount ? ((await page.locator("[data-sonner-toast]").first().innerText()) ?? "").trim() : "(no sonner toast rendered)";
  const banner = page.locator("[role=alert], [role=status]");
  const bannerText = (await banner.count()) ? ((await banner.first().innerText()) ?? "").trim() : "(no alert/status region)";
  console.log(`R81_D603_R90 surface: sonnerToasts=${toastCount} toast="${toastText.slice(0, 200)}" alertRegion="${bannerText.slice(0, 300)}"`);

  // Still on the form -- a refusal must not have navigated as if it saved.
  expect(page.url()).toContain("/scope/new");
});

// ---------------------------------------------------------------------------
// R-91  Cold start "Failed to fetch" on first submit
// TRUE when: the FIRST submit against a not-yet-compiled route comes back with
// a real HTTP response rather than a transport failure ("Failed to fetch" /
// "The request never reached the server").
// Uses a body /api/scope's own proxy rejects before callVeridian, so this
// exercises the cold compile of exactly the route a first submit hits, and
// writes nothing.
// ---------------------------------------------------------------------------
test("R-91 the first submit against the cold create route returns HTTP, not a transport failure", async ({ page }) => {
  await warmGoto(page, `/scope/new?projectId=${P}`);
  await expect(page.getByLabel("Item code, line 1")).toBeVisible({ timeout: 30_000 });

  const started = Date.now();
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "this-is-not-json",
      });
      const text = await res.text();
      return { transport: "ok" as const, status: res.status, body: text.slice(0, 300) };
    } catch (e) {
      return { transport: "failed" as const, status: 0, body: e instanceof Error ? e.message : String(e) };
    }
  });
  const elapsed = Date.now() - started;

  console.log(`R81_D603_R91 transport=${result.transport} status=${result.status} elapsedMs=${elapsed} body=${result.body}`);

  expect(result.transport, `first submit failed at the transport layer: ${result.body}`).toBe("ok");
  expect(result.body.toLowerCase(), "the browser must not surface 'Failed to fetch'").not.toContain("failed to fetch");
  // A real, answered request -- any HTTP status proves the route answered.
  expect(result.status).toBeGreaterThan(0);
});
