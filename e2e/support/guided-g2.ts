import { expect, type Locator, type Page } from "@playwright/test";

// GUIDED ERRORS, group G2 (work progress, change orders, billing, site instructions, invoices, exceptions): shared helpers for the e2e/guided-g2-*.spec.ts
// files. Every test triggers a fault through the real screen and then checks the five things the owner asked for:
//   1. the panel names what happened (title + what), why, and numbered steps,
//   2. the "Fix it now" button goes to the right place and the element is outlined (data-px-highlighted),
//   3. the fault is also written beside its field,
//   4. what was typed is still there after the fix / after leaving and coming back,
//   5. the outcome persisted (re-read from the API), or nothing was saved when the fault stopped the save.

/** The guide panel on screen (there is at most one at a time per form). */
export function guidePanel(page: Page): Locator {
  return page.getByTestId("guided-error").first();
}

export type GuideExpect = { id?: string; code?: string; title?: RegExp; what?: RegExp; why?: RegExp; minSteps?: number; fixLabel?: RegExp };

/** The panel is complete: a title, what happened, why, 1+ numbered steps, and (when asked) a fix button. */
export async function expectCompleteGuide(page: Page, want: GuideExpect = {}): Promise<void> {
  const panel = guidePanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "alert");
  if (want.id) await expect(panel).toHaveAttribute("data-guide-id", want.id);
  if (want.code) await expect(page.getByTestId("fault-panel").first()).toHaveAttribute("data-fault-code", want.code);
  const title = panel.getByTestId("guided-error-title");
  await expect(title).not.toHaveText("");
  expect((await title.innerText()).split(/\s+/).length, "title is 8 words or fewer").toBeLessThanOrEqual(8);
  if (want.title) await expect(title).toHaveText(want.title);
  await expect(panel.getByTestId("guided-error-what")).not.toHaveText("");
  if (want.what) await expect(panel.getByTestId("guided-error-what")).toHaveText(want.what);
  await expect(panel.getByTestId("guided-error-why")).not.toHaveText("");
  if (want.why) await expect(panel.getByTestId("guided-error-why")).toHaveText(want.why);
  const steps = panel.getByTestId("guided-error-steps").locator("li");
  expect(await steps.count()).toBeGreaterThanOrEqual(want.minSteps ?? 1);
  expect(await steps.count()).toBeLessThanOrEqual(4);
  if (want.fixLabel) await expect(panel.getByTestId("guided-error-fix")).toHaveText(want.fixLabel);
}

/** Presses "Fix it now" and waits for the named element to be outlined (the 3-second highlight). */
export async function pressFixAndExpectHighlight(page: Page, testId: string): Promise<void> {
  await guidePanel(page).getByTestId("guided-error-fix").click();
  await expect(page.locator(`[data-testid="${testId}"], #${testId}`).first()).toHaveAttribute("data-px-highlighted", "true");
}

/** After a "Fix it now" that left this screen: the strip says where to go back to, and Back returns there. */
export async function goBackViaStrip(page: Page, expectUrl: RegExp): Promise<void> {
  const strip = page.getByTestId("return-strip");
  await expect(strip).toBeVisible();
  await strip.getByTestId("return-strip-back").click();
  await page.waitForURL(expectUrl);
}

/** Reads JSON from the app's own API with the signed-in browser session (to re-read what persisted). */
export async function apiJson<T = any>(page: Page, path: string): Promise<T> {
  // the data service answers 503 "did not respond in time" on a cold call and this laptop's link resets now and then: ask again, like a person would (3 more tries)
  let res = await page.request.get(path).catch(() => null);
  for (let attempt = 0; attempt < 3 && (!res || [502, 503, 504].includes(res.status())); attempt++) {
    await page.waitForTimeout(3_000 * (attempt + 1));
    res = await page.request.get(path).catch(() => null);
  }
  expect(res?.ok(), `GET ${path} => ${res?.status() ?? "no answer"}`).toBeTruthy();
  return (await res!.json()) as T;
}

/** The text every AUDIT-created record carries so a reviewer can find (and never delete) it. */
export const AUDIT_TAG = "AUDIT G2 guided-errors";
export const stamp = () => new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

/** The message written beside a field (FormField's error line, wired to the control by aria-describedby), or beside a plain control (next sibling alert). */
export async function fieldMessage(page: Page, testId: string): Promise<Locator> {
  const control = page.getByTestId(testId).first();
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter((i) => i.endsWith("-error"));
  expect(ids.length, `${testId} should name its error line in aria-describedby`).toBeGreaterThan(0);
  return page.locator(`[id="${ids[0]}"]`);
}
