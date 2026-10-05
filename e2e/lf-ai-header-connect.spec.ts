import { test, expect, type Page, type Route } from "@playwright/test";
import { goOffline, goOnline, prepareLaptop } from "./support/lf-ai-laptop";
import { APP_ORIGIN } from "./support/boq-local";

// Audit 100 (checklist rows B53, A37, A36 in part): the AI buttons of the app header, in a REAL browser against the production build.
//   "Copy AI prompt"  puts the owner-approved prompt, with the person's one user-wide link inside, on the clipboard - with or without a project.
//   "Connectors"      opens the Connect panel: MCP address, OpenAPI address, Swagger address and the small prompt, each with its own Copy button.
// Both need the server to make a link, so offline they are shown disabled with the reason; a read-only role sees a plain sentence instead.
//
// Runs through playwright.local-first.config.ts (production build, local Auth stand-in, every /api and sync call answered in the browser).
// The one thing answered here is the work-link service's POST /user-link, by context.route, with the SAME shape the real service returns
// (supabase/functions/ai-work-link/mint.ts), so what the buttons do with it is real. The link is a made-up placeholder, not a credential.

const AWL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link";
const TOKEN = "pxa_" + "fedcba9876543210".repeat(4);
const LINK = `${AWL}/${TOKEN}`;
const PROMPT =
  "PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): " + LINK;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, OPTIONS" };

/** Answers POST /user-link like the real service (201, token shown once) and counts the mints. Returns the requests seen. */
async function stubUserLink(page: Page): Promise<{ bodies: unknown[]; auth: string[] }> {
  const seen = { bodies: [] as unknown[], auth: [] as string[] };
  await page.context().route(`${AWL}/user-link`, async (route: Route, request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    seen.bodies.push(request.postDataJSON());
    seen.auth.push((await request.allHeaders())["authorization"] ?? "");
    return route.fulfill({
      status: 201,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({
        link_id: "lflink" + String(seen.bodies.length).padStart(4, "0"),
        token: TOKEN,
        scope: "user",
        level: 1,
        expires_at: "2099-01-01T00:00:00Z",
        label: "All my projects",
        project: null,
        shell: false,
        links: { link: LINK, inbox: null },
      }),
    });
  });
  return seen;
}

/** After the one-time install the page is still the server's own screen; the AI buttons live in the laptop shell (/local). */
async function openShell(page: Page, projectId?: string) {
  await page.goto(projectId ? `/local?projectId=${projectId}` : "/local");
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 60_000 });
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.describe("header AI buttons and the Connect panel (real browser)", () => {
  test("Copy AI prompt and Connectors work with a project open: exact prompt on the clipboard, one mint reused, every Connect address copies exactly", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    const seen = await stubUserLink(page);
    await openShell(page, laptop.person.projects[0].id);

    const bar = page.getByTestId("local-shell-ai-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-online", "1");
    await expect(page.getByTestId("local-shell-ai-caption")).toHaveText("Paste it into any AI to work for you");
    await expect(page.getByTestId("local-shell-connect-caption")).toHaveText("Connect PROJEXA to your AI app");

    await test.step("Copy AI prompt: the owner-approved prompt with the personal link is on the clipboard", async () => {
      const copy = bar.getByRole("button", { name: /Copy AI prompt|Prompt copied/i });
      await expect(copy).toBeEnabled();
      await copy.click();
      await expect.poll(() => clipboard(page), { message: "the prompt never reached the clipboard", timeout: 20_000 }).toBe(PROMPT);
      expect(seen.bodies).toEqual([{ days: 7 }]);
      expect(seen.auth[0]).toMatch(/^Bearer .{10,}/);
      // clicking again copies the same prompt again WITHOUT making another link
      await page.evaluate(() => navigator.clipboard.writeText("something else"));
      await copy.click();
      await expect.poll(() => clipboard(page), { timeout: 20_000 }).toBe(PROMPT);
      expect(seen.bodies.length).toBe(1);
    });

    await test.step("Connectors: the panel opens and shows the three addresses and the small prompt", async () => {
      await page.getByTestId("local-shell-connectors").click();
      const panel = page.getByTestId("local-shell-connectors-panel");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("awl-connect")).toBeVisible();
      await expect(page.getByTestId("awl-connect-value-mcp")).toHaveText(LINK);
      await expect(page.getByTestId("awl-connect-value-openapi")).toHaveText(`${LINK}/openapi.json`);
      await expect(page.getByTestId("awl-connect-value-swagger")).toHaveText(`${LINK}/swagger.json`);
      await expect(page.getByTestId("awl-connect-row-prompt")).toBeVisible();
      await expect(page.getByTestId("awl-connect-free-note")).toHaveText("Some free AI plans do not allow connectors; then paste the prompt instead.");
      await expect(page.getByTestId("awl-connect-warning")).toContainText("Your link is your password.");
      // the panel never prints the bare token anywhere except inside the addresses
      expect(await panel.innerText()).not.toMatch(/(^|[^/])pxa_[0-9a-f]{20}/);

      for (const [key, want] of [["mcp", LINK], ["openapi", `${LINK}/openapi.json`], ["swagger", `${LINK}/swagger.json`], ["prompt", PROMPT]] as const) {
        await page.evaluate(() => navigator.clipboard.writeText("cleared"));
        const button = page.getByTestId(`awl-connect-copy-${key}`);
        await button.click();
        await expect(button).toHaveText("Copied");
        expect(await clipboard(page), `Copy button of ${key}`).toBe(want);
      }
    });

    await test.step("Connectors again: closing and opening the panel reuses the link", async () => {
      const mintsBefore = seen.bodies.length;
      await page.getByTestId("local-shell-connectors").click();
      await expect(page.getByTestId("local-shell-connectors-panel")).toHaveCount(0);
      await page.getByTestId("local-shell-connectors").click();
      await expect(page.getByTestId("awl-connect-value-mcp")).toHaveText(LINK);
      expect(seen.bodies.length).toBe(mintsBefore);
    });

    // every link the header makes asks for the same 7 days (the Connectors panel mints through its own code path, not only the Copy button)
    expect(seen.bodies).toEqual(seen.bodies.map(() => ({ days: 7 })));

    void laptop;
  });

  test("with NO project selected both buttons are still there and still work (the AI can list the projects and create one)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
    await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    const seen = await stubUserLink(page);
    // the shell with no project chosen
    await openShell(page);
    const bar = page.getByTestId("local-shell-ai-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-online", "1");
    await bar.getByRole("button", { name: /Copy AI prompt/i }).click();
    await expect.poll(() => clipboard(page), { timeout: 20_000 }).toBe(PROMPT);
    await page.getByTestId("local-shell-connectors").click();
    await expect(page.getByTestId("awl-connect-value-openapi")).toHaveText(`${LINK}/openapi.json`);
    expect(seen.bodies.length).toBeGreaterThanOrEqual(1);
    expect(seen.bodies).toEqual(seen.bodies.map(() => ({ days: 7 })));
  });

  test("a refusal from the service is shown in plain words, and the next click can try again", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    await openShell(page, laptop.person.projects[0].id);
    let calls = 0;
    await context.route(`${AWL}/user-link`, async (route, request) => {
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      calls += 1;
      return route.fulfill({ status: 429, headers: CORS, contentType: "application/json", body: JSON.stringify({ error: "You have made too many links. Try again later.", code: "MINT_CAP_HOUR" }) });
    });
    await page.getByTestId("local-shell-connectors").click();
    const alert = page.getByTestId("local-shell-connectors-panel").getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).not.toContainText("pxa_");
    await expect(alert).not.toBeEmpty();
    expect(calls).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("awl-connect")).toHaveCount(0);
  });

  test("offline both buttons are disabled with the reason; back online they work again", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    await stubUserLink(page);
    await openShell(page, laptop.person.projects[0].id);
    await goOffline(laptop);
    const bar = page.getByTestId("local-shell-ai-bar");
    await expect(bar).toHaveAttribute("data-online", "0", { timeout: 30_000 });
    await expect(page.getByTestId("local-shell-ai-link-offline-button")).toBeDisabled();
    await expect(page.getByTestId("local-shell-connectors-offline")).toBeDisabled();
    await expect(page.getByTestId("local-shell-ai-link-offline-note")).not.toBeEmpty();
    await goOnline(laptop);
    await expect(bar).toHaveAttribute("data-online", "1", { timeout: 30_000 });
    await expect(bar.getByRole("button", { name: /Copy AI prompt/i })).toBeEnabled();
    await expect(page.getByTestId("local-shell-connectors")).toBeEnabled();
  });

  test("a read-only role sees a plain sentence instead of the AI buttons", async ({ page, context }) => {
    const laptop = await prepareLaptop(page, context, "viewer");
    await openShell(page, laptop.person.projects[0].id);
    await expect(page.getByTestId("local-shell-ai-role-note")).toBeVisible();
    await expect(page.getByTestId("local-shell-connectors")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Copy AI prompt/i })).toHaveCount(0);
  });
});
