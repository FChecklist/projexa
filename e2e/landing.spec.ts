import { expect, test } from "@playwright/test";
import { uniqueSuffix } from "./helpers";

// S12.A.A4 (W-WEB): the merged English landing page (10 problems + fixes,
// good news band, how-it-works rows, Day 0/31/60 proof, price + guarantee)
// and its extended /api/contact lead-capture form.
//
// Same "local production build only" contract as e2e/public-pages-perf.spec.ts,
// and joins its "public-pages" project (playwright.config.ts) for the same
// reason: this exercises the logged-out home page, so it must not depend on
// auth.setup.ts's real login against production.
//
//     bun run build && bun run start          # terminal 1, port 3100
//     PLAYWRIGHT_BASE_URL=http://localhost:3100 \
//       bunx playwright test e2e/landing.spec.ts --project=public-pages
//
// PAGE-WEIGHT BUDGET NOTE. The task that produced this file specified a 40KB
// budget, written when the plan was to port website/projexa-ai-com-v4's
// standalone static HTML in as a brand-new page. The S12.A ruling superseded
// that: the v4 copy is merged into the real, already-shipped Next.js
// LandingPage component tree instead (bilingual, hydrated, Tailwind-built)
// -- a page in that shape cannot honestly be under 40KB (the framework
// runtime alone exceeds it), and claiming otherwise by measuring only the
// HTML document while ignoring its JS would misrepresent what J-03 in
// public-pages-perf.spec.ts already measures for this exact route: total
// on-the-wire transfer, budgeted at 500 KB. This file applies that same,
// already-vetted budget and methodology instead of the superseded 40KB
// figure -- see W-WEB_NOTES.md for the full note.
function isLocalTarget(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL);
}

test.describe("landing page (English) -- v4 content merge + lead capture", () => {
  test.skip(
    ({ baseURL }) => !isLocalTarget(baseURL),
    "Requires a local production build -- set PLAYWRIGHT_BASE_URL=http://localhost:3100 after `bun run build && bun run start`."
  );

  test("renders the merged v4 content: ten problems, good news, how-it-works, proof, price", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    // Ten problems + fixes (ProblemSection, English branch).
    await expect(page.getByText("The ten problems that create 90% of rework, confusion and cost escalation.")).toBeVisible();
    await expect(page.getByText("Extra work is done, never billed")).toBeVisible();
    await expect(page.getByText("The owner decides from memory")).toBeVisible();
    await expect(page.getByText("Industry estimate; PROJEXA is built to measure your actual figure on your own projects.")).toBeVisible();

    // Good-news band: three role cards + 15-minute method (SolutionSection, English branch).
    await expect(page.getByText("All ten are the same problem. So one system ends all ten.")).toBeVisible();
    await expect(page.getByText("For the owner")).toBeVisible();
    await expect(page.getByText("For the project manager")).toBeVisible();
    await expect(page.getByText("For the site")).toBeVisible();
    await expect(page.getByText("15 minutes a day. No data feeding.", { exact: false })).toBeVisible();

    // How-it-works rows (CopilotSpotlight, English append).
    await expect(page.getByText("You tell it. AI completes it. You decide.")).toBeVisible();
    await expect(page.getByText("Tell it, in one line")).toBeVisible();

    // Day 0/31/60 + price/guarantee (new ProofAndPricingSection).
    await expect(page.getByText("Your project, live")).toBeVisible();
    await expect(page.getByText("Customised, free")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Money back", exact: true })).toBeVisible();
    await expect(page.getByText("USD 100")).toBeVisible();
    await expect(page.getByText("100% money back on day 60.")).toBeVisible();

    // No claim CLAIMS_RESOLUTION.md marked MISSING ships as literal copy.
    await expect(page.getByText("WhatsApp groups needed", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Your usage dashboard is the only judge", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Two actions prepared. Approve both?", { exact: false })).toHaveCount(0);
  });

  test("the /hi route is unaffected by the English merge", async ({ page }) => {
    await page.goto("/hi", { waitUntil: "load" });
    // The original Hindi copy for these two sections is still what renders --
    // not the new v4-merged English content, and not an empty/missing-key gap.
    await expect(page.getByText("काम महंगा नहीं है। महंगा है समन्वय।")).toBeVisible();
    await expect(page.getByText("हर मॉड्यूल हर दूसरे मॉड्यूल से जुड़ा है।")).toBeVisible();
    await expect(page.getByText("The ten problems that create 90% of rework")).toHaveCount(0);
    await expect(page.getByText("USD 100")).toHaveCount(0);
  });

  test("the lead form submits through /api/contact and creates a row", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `landing-${suffix}@example.com`;

    await page.goto("/", { waitUntil: "load" });
    await page.locator("#home-name").fill(`Landing Test ${suffix}`);
    await page.locator("#home-email").fill(email);
    await page.locator("#home-phone").fill("+91 98765 43210");

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/contact") && r.request().method() === "POST"),
      page.locator("#contact-form button[type=submit]").click(),
    ]);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
    await expect(page.getByText("We've got your message.")).toBeVisible();
  });

  test("the API rejects an invalid email and an invalid mobile number", async ({ page }) => {
    const suffix = uniqueSuffix();

    const badEmail = await page.request.post("/api/contact", {
      data: { name: `Bad Email ${suffix}`, email: "not-an-email", sourcePage: "home" },
    });
    expect(badEmail.status()).toBe(400);
    expect((await badEmail.json()).ok).toBe(false);

    const badPhone = await page.request.post("/api/contact", {
      data: { name: `Bad Phone ${suffix}`, email: `bad-phone-${suffix}@example.com`, phone: "12", sourcePage: "home" },
    });
    expect(badPhone.status()).toBe(400);
    expect((await badPhone.json()).ok).toBe(false);
  });

  test("no external requests are issued loading the home page", async ({ page, baseURL }) => {
    const ownOrigin = new URL(baseURL!).origin;
    const externalRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (!url.startsWith(ownOrigin)) externalRequests.push(url);
    });

    await page.goto("/", { waitUntil: "networkidle" });
    expect(externalRequests).toEqual([]);
  });

  test("page weight stays within this route's established 500 KB transfer budget", async ({ browser }) => {
    // Same on-the-wire measurement as public-pages-perf.spec.ts's J-03 --
    // see the file header note for why 500 KB (not the superseded 40KB) is
    // the honest budget for this route now.
    const context = await browser.newContext();
    const page = await context.newPage();
    const sizes: Promise<number>[] = [];
    page.on("response", (response) => {
      sizes.push(
        response.request().sizes().then((s) => s.responseBodySize).catch(() => 0)
      );
    });

    await page.goto("/", { waitUntil: "networkidle" });
    const transferred = (await Promise.all(sizes)).reduce((sum, n) => sum + n, 0);
    expect(transferred).toBeGreaterThan(0);
    expect(transferred).toBeLessThanOrEqual(500 * 1024);

    await context.close();
  });
});
