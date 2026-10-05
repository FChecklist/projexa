import type { Page } from "@playwright/test";
/**
 * page.evaluate that survives the ONE navigation the app makes by itself after the install (AUDIT-100 A3 step 1: the server-rendered page hands
 * over to the shell on the laptop). A read that lands in the middle of it is simply read again from the new document.
 */
export async function evalSettled<R, A>(page: Page, fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await page.evaluate(fn as never, arg as never)) as R;
    } catch (err) {
      if (attempt >= 5 || !/Execution context was destroyed|because of a navigation|Cannot find context with specified id/i.test(String(err))) throw err;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
}
