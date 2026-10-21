import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { uniqueSuffix } from "../helpers";

// GUIDED ERRORS, GROUP G3 -- shared helpers for the e2e/guided-g3-*.spec.ts files.
//
// The owner's requirement, in four checks every fault test makes:
//   1. the screen shows a COMPLETE description: a title, what happened, why, and numbered steps (expectGuide)
//   2. the "Fix it now" button goes to the EXACT place (its href path, its ?focus= element) and the place is highlighted when we arrive (followFix)
//   3. the "Back to ..." strip brings the person back with everything they typed still in place (goBack)
//   4. after the correction the save goes through and the result is PERSISTED (re-read through the API by the test)
//
// Test data: every project, material, worker... a test creates is labelled "AUDIT-G3 ..." and is never deleted.
// Run against the live site with PLAYWRIGHT_BASE_URL (default https://projexa-ai.com, see playwright.config.ts).

export const AUDIT = "AUDIT-G3";

/** The guided panel on the screen (there is only ever one the test cares about at a time). */
export function panel(page: Page): Locator {
  return page.getByTestId("guided-error").first();
}

export type GuideExpect = {
  /** The guide's id (data-guide-id on the panel). Optional: the catalogue may be re-worded, the id is the contract. */
  id?: string | RegExp;
  /** Words that must appear in the "what happened" sentence. */
  what?: string | RegExp;
  /** Words that must appear in the title. */
  title?: string | RegExp;
  /** The fix button's label. */
  fix?: string | RegExp;
};

/** The panel is visible and complete: title, what, why, at least one numbered step. Returns the panel. */
export async function expectGuide(page: Page, want: GuideExpect = {}): Promise<Locator> {
  const p = panel(page);
  await expect(p).toBeVisible();
  await expect(p).toHaveAttribute("role", "alert");
  if (want.id) await expect(p).toHaveAttribute("data-guide-id", want.id);
  const title = p.getByTestId("guided-error-title");
  const what = p.getByTestId("guided-error-what");
  const why = p.getByTestId("guided-error-why");
  const steps = p.getByTestId("guided-error-steps").locator("li");
  await expect(title).not.toBeEmpty();
  await expect(what).not.toBeEmpty();
  await expect(why).not.toBeEmpty();
  expect(await steps.count()).toBeGreaterThanOrEqual(1);
  // the title is plain words, 8 or fewer
  const titleText = ((await title.textContent()) ?? "").trim();
  expect(titleText.split(/\s+/).length).toBeLessThanOrEqual(8);
  if (want.title) await expect(title).toContainText(want.title);
  if (want.what) await expect(what).toContainText(want.what);
  if (want.fix) await expect(p.getByTestId("guided-error-fix")).toContainText(want.fix);
  return p;
}

/** The element carrying the 3-second "this is the place to correct" outline. */
export function highlighted(page: Page): Locator {
  return page.locator('[data-px-highlighted="true"]').first();
}

/**
 * Press "Fix it now": asserts the button's address (path and ?focus=), follows it, and asserts the element is highlighted on arrival.
 * `path` is the page the fix must lead to (a string compared with the URL's pathname, or a RegExp); `focus` the id/testid/name of the element.
 */
export async function followFix(page: Page, want: { path: string | RegExp; focus?: string; highlightId?: string }): Promise<void> {
  const fix = panel(page).getByTestId("guided-error-fix");
  await expect(fix).toBeVisible();
  const href = (await fix.getAttribute("href")) ?? "";
  const url = new URL(href, page.url());
  if (typeof want.path === "string") expect(url.pathname).toBe(want.path);
  else expect(url.pathname).toMatch(want.path);
  if (want.focus) expect(url.searchParams.get("focus")).toBe(want.focus);
  await fix.click();
  if (typeof want.path === "string") await page.waitForURL((u) => u.pathname === want.path);
  else await page.waitForURL((u) => want.path instanceof RegExp && want.path.test(u.pathname));
  if (want.focus) {
    const el = highlighted(page);
    await expect(el).toBeVisible({ timeout: 10_000 });
    const mark = await el.evaluate((node) => ({ id: node.id, testid: node.getAttribute("data-testid"), name: node.getAttribute("name") }));
    const wanted = want.highlightId ?? want.focus;
    expect([mark.id, mark.testid, mark.name]).toContain(wanted);
  }
}

/** Press the "Back to <what you were doing>" strip; resolves once the original screen is showing again. */
export async function goBack(page: Page, expectPath: string | RegExp): Promise<void> {
  const strip = page.getByTestId("return-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("return-strip-back")).toContainText("Back to");
  await page.getByTestId("return-strip-back").click();
  if (typeof expectPath === "string") await page.waitForURL((u) => u.pathname === expectPath);
  else await page.waitForURL((u) => expectPath.test(u.pathname));
}

/** The "Save (...)" / "Save" primary of a create screen. */
export function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(Save|Adding|Saving|Creating|Create)/ }).first();
}

/** A new, empty project that belongs to nobody's real data: the only way to test "nothing set up yet" faults on a shared org. Never deleted. */
export async function createAuditProject(request: APIRequestContext, label: string): Promise<{ id: string; name: string }> {
  const name = `${AUDIT} ${label} ${uniqueSuffix()}`;
  const res = await request.post("/api/projects", { data: { name } });
  expect(res.ok(), `creating the audit project answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { id?: string; project?: { id?: string } };
  const id = body.id ?? body.project?.id;
  expect(id, "the new project has an id").toBeTruthy();
  return { id: id as string, name };
}

/** Re-read a list through the API and return the rows (the test's proof that the corrected value was PERSISTED, not just acknowledged). */
export async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.ok(), `GET ${path} answered ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

export function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** A tiny real file for upload tests. */
export function pdfBuffer(size = 1200): Buffer {
  const head = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x20)]);
}
