import { expect, test, type Page, type Response } from "@playwright/test";

// R67 workstream J -- the audit's own acceptance clauses for J-01 (R-246),
// J-02 (R-279) and J-03 (R-280), written as runnable checks instead of a
// paragraph in a report.
//
// READ THIS BEFORE RUNNING IT. Two things make this file different from
// every other spec here:
//
// 1. IT ONLY RUNS AGAINST A LOCAL PRODUCTION BUILD. playwright.config.ts
//    defaults baseURL to the live https://projexa-ai.com, and these are
//    timing assertions against a locally built, locally served app -- run
//    against production they would measure the network between this laptop
//    and Vercel's edge, which is not what any of them is about. So the whole
//    file skips unless PLAYWRIGHT_BASE_URL names a local origin:
//
//        bun run build && bun run start          # terminal 1, port 3100
//        PLAYWRIGHT_BASE_URL=http://localhost:3100 \
//          bunx playwright test e2e/public-pages-perf.spec.ts --project=chromium
//
// 2. `next dev` will NOT do. The ISR/static behaviour these assertions are
//    about only exists in a production build -- in dev every route is
//    rendered per request by design, so the warm-TTFB test would fail for a
//    reason that has nothing to do with the code under test.
//
// HONESTY NOTE, R67 workstream J: this file has NOT been executed. The
// programme's operating rules forbid starting a server in these worktrees,
// so it was written and typechecked but never run. What WAS verified for
// these three items, without a server, is recorded in
// ai-os/audit/public_pages_transfer.json and in the sibling unit tests
// (src/app/public-routes-static.test.ts, src/components/marketing/
// Reveal.test.tsx, src/i18n/client-messages.test.ts).

const LANDING_HEADLINE = "Every deadline, drawing and decision. One coordinated system.";

function isLocalTarget(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL);
}

/** TTFB for the document request, in ms. */
function ttfbMs(response: Response): number {
  const timing = response.request().timing();
  return timing.responseStart - timing.requestStart;
}

/** first-contentful-paint from the Performance API, in ms. */
async function fcpMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const entry = performance.getEntriesByName("first-contentful-paint")[0];
    return entry ? entry.startTime : Number.POSITIVE_INFINITY;
  });
}

test.describe("public pages -- static, light, painted", () => {
  test.skip(
    ({ baseURL }) => !isLocalTarget(baseURL),
    "Timing assertions against a local production build only -- set PLAYWRIGHT_BASE_URL=http://localhost:3100 after `bun run build && bun run start`."
  );

  test("J-01: the warm load of / is served from the prerendered copy", async ({ page }) => {
    // Moto G-class throttling, per the audit's "throttled mobile profile".
    // Chromium-only, which is the project this file is meant to run in.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    // First navigation warms the ISR cache; the second is the one the
    // finding is about (R-246 measured the WARM paint at 1672 ms, slower
    // than the cold one, because nothing was ever cached).
    await page.goto("/", { waitUntil: "load" });
    const warm = await page.goto("/", { waitUntil: "commit" });
    expect(warm, "the document response").not.toBeNull();

    expect(ttfbMs(warm!)).toBeLessThanOrEqual(150);
    await expect(page.getByText(LANDING_HEADLINE)).toBeVisible({ timeout: 500 });

    // And the header the same change added, so a CDN actually caches it.
    expect(warm!.headers()["cache-control"]).toContain("s-maxage=3600");
  });

  test("J-03: a cold load of / transfers no more than 500 KB", async ({ browser }) => {
    // A fresh context so nothing is served from a warm disk cache.
    const context = await browser.newContext();
    const page = await context.newPage();

    let transferred = 0;
    page.on("response", (response) => {
      void response
        .body()
        .then((body) => {
          transferred += body.length;
        })
        .catch(() => {
          // Redirects and cached-without-body responses have none to read.
        });
    });

    await page.goto("/", { waitUntil: "networkidle" });

    expect(transferred).toBeLessThanOrEqual(500 * 1024);
    expect(await fcpMs(page)).toBeLessThanOrEqual(800);

    await context.close();
  });

  for (const route of ["/", "/how-it-works"]) {
    for (const width of [1440, 375]) {
      test(`J-02: every section of ${route} is painted at ${width}px with no JS and reduced motion`, async ({
        browser,
      }) => {
        // The exact combination the finding was invisible under: the reveal
        // wrapper used to render opacity-0 and depended on client JS to
        // undo it, so this context saw a hero followed by empty background.
        const context = await browser.newContext({
          javaScriptEnabled: false,
          reducedMotion: "reduce",
          viewport: { width, height: 900 },
        });
        const page = await context.newPage();
        await page.goto(route, { waitUntil: "load" });

        const sections = page.locator("section");
        const count = await sections.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i += 1) {
          const section = sections.nth(i);
          const box = await section.boundingBox();
          expect(box, `section ${i} of ${route} has a box`).not.toBeNull();
          expect(box!.height, `section ${i} of ${route} has height`).toBeGreaterThan(0);
        }

        // No wrapper anywhere on the page is left transparent.
        const transparent = await page.evaluate(
          () =>
            [...document.querySelectorAll("body *")].filter(
              (el) => getComputedStyle(el).opacity === "0"
            ).length
        );
        expect(transparent).toBe(0);

        await page.screenshot({
          path: `e2e-results/public-pages/${route === "/" ? "landing" : "how-it-works"}-${width}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
