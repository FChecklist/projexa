import { test, expect, type Page, type Route } from "@playwright/test";
import { goOffline, goOnline, prepareLaptop } from "./support/lf-ai-laptop";

// "+ Connect to AI" (owner order 2026-10-11), in a REAL browser against the production build. It replaces lf-ai-header-connect.spec.ts: the copy-this-prompt
// button and the Connectors button are gone from the header (an outside chat website often cannot open the link); the one AI control is "+ Connect to AI",
// which opens a panel on the right listing ChatGPT, Claude, Gemini, Copilot, DeepSeek, z.ai, Grok and Others, with the person's own key form.
//
//   1. online: the only AI control is + Connect to AI (no "Copy AI prompt", no "Connectors"); it opens the panel with all eight AIs in the owner's order.
//   2. an owner pastes a key: the browser sends it ONCE to /api/org/own-ai/mine, the box is wiped, and the panel then says an AI is connected - read back
//      from the service, not from a success message.
//   3. offline: the control says it needs internet, the shell is NOT blocked (traditional software keeps working), and back online it connects again.
//   4. a read-only role sees a plain sentence instead of the button.
//
// Runs through playwright.local-first.config.ts (production build, local Auth stand-in, every /api and sync call answered in the browser). The ONE thing
// answered here is /api/org/own-ai, by page.route, with the SAME shape VERIDIAN returns (compliance-tracker src/lib/ai/org-own-ai.ts getAiPicture), so
// what the panel does with it is real. The key below is a made-up placeholder, not a credential.

const NOT_CONNECTED = {
  effective: { connected: false, source: null, provider: null, model: null, sharedByName: null },
  mine: { connected: false, provider: null, model: null, sharedWith: [] },
  sharedWithMe: [],
  org: { connected: false, provider: null, model: null },
};
const CONNECTED_MINE = {
  effective: { connected: true, source: "mine", provider: "openai", model: "gpt-4o-mini", sharedByName: null },
  mine: { connected: true, provider: "openai", model: "gpt-4o-mini", sharedWith: [] },
  sharedWithMe: [],
  org: { connected: false, provider: null, model: null },
};
const FAKE_KEY = "sk-fake-e2e-key-for-tests-only";

/** Answers the Connect service like VERIDIAN does and remembers what the browser sent. */
async function stubConnectService(page: Page): Promise<{ puts: unknown[]; connected: () => boolean }> {
  let connected = false;
  const puts: unknown[] = [];
  await page.route("**/api/org/own-ai", async (route: Route, request) => {
    if (request.method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connected ? CONNECTED_MINE : NOT_CONNECTED) });
  });
  await page.route("**/api/org/own-ai/mine", async (route: Route, request) => {
    if (request.method() !== "PUT") return route.fallback();
    puts.push(request.postDataJSON());
    connected = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...CONNECTED_MINE.mine, changedAt: null }) });
  });
  await page.route("**/api/org/own-ai/people", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ people: [] }) }));
  return { puts, connected: () => connected };
}

const AWL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, OPTIONS" };
const TOKEN = "pxa_" + "fedcba9876543210".repeat(4);

/** The work-link service, answered like the real one (mint.ts): POST /user-link makes the code; GET /links lists it with `last_used_at`. */
async function stubWorkLinkService(page: Page): Promise<{ aiUsesTheCode: () => void; mints: unknown[] }> {
  let lastUsed: string | null = null;
  const mints: unknown[] = [];
  await page.context().route(`${AWL}/user-link`, async (route: Route, request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    mints.push(request.postDataJSON());
    return route.fulfill({
      status: 201, headers: CORS, contentType: "application/json",
      body: JSON.stringify({ link_id: "lfwiz0001", token: TOKEN, scope: "user", level: 1, expires_at: "2099-01-01T00:00:00Z", label: "ChatGPT connection", project: null, shell: false, links: { link: `${AWL}/${TOKEN}`, inbox: null } }),
    });
  });
  await page.context().route(`${AWL}/links`, async (route: Route, request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({
      status: 200, headers: CORS, contentType: "application/json",
      body: JSON.stringify({ links: [{ id: "lfwiz0001", scope: "user", project_id: null, project_name: null, label: "ChatGPT connection", level: 1, created_at: new Date(Date.now() - 5_000).toISOString(), expires_at: "2099-01-01T00:00:00Z", revoked_at: null, last_used_at: lastUsed, active: true }] }),
    });
  });
  return { aiUsesTheCode: () => { lastUsed = new Date().toISOString(); }, mints };
}

async function openShell(page: Page, projectId?: string) {
  await page.goto(projectId ? `/local?projectId=${projectId}` : "/local");
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 60_000 });
}

test.describe("+ Connect to AI (real browser)", () => {
  test("the only AI control is + Connect to AI; it opens the panel with the eight AIs in order", async ({ page, context }) => {
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    await stubConnectService(page);
    await openShell(page, laptop.person.projects[0].id);

    const bar = page.getByTestId("local-shell-ai-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-online", "1");
    await expect(page.getByRole("button", { name: "+ Connect to AI" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy AI prompt/i })).toHaveCount(0);
    await expect(page.getByTestId("local-shell-connectors")).toHaveCount(0);

    await page.getByTestId("connect-your-ai-open").click();
    const panel = page.getByTestId("connect-your-ai-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("own-ai-status")).toContainText("No AI connected yet", { timeout: 20_000 });
    const names = await panel.locator('[data-testid^="connect-provider-name-"]').allTextContents();
    expect(names).toEqual(["ChatGPT", "Gemini", "Copilot", "Grok", "DeepSeek", "z.ai", "Claude", "Others"]);
  });

  test("an owner pastes a key: sent once, the box is wiped, and the panel reads the connection back from the service", async ({ page, context }) => {
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    const service = await stubConnectService(page);
    await openShell(page, laptop.person.projects[0].id);

    await page.getByTestId("connect-your-ai-open").click();
    const panel = page.getByTestId("connect-your-ai-panel");
    await panel.getByTestId("connect-provider-chatgpt").getByRole("button").first().click();
    const key = panel.getByTestId("own-key-chatgpt-key");
    await expect(key).toHaveAttribute("type", "password");
    await key.fill(FAKE_KEY);
    await panel.getByTestId("own-key-chatgpt-connect").click();

    await expect(panel.getByTestId("own-key-chatgpt").getByRole("status")).toContainText("Your chat box now works with ChatGPT (OpenAI)", { timeout: 20_000 });
    // a wrong-looking key is caught on the page, in plain words, before anything is sent
    await key.fill("hunter2@example.com");
    await panel.getByTestId("own-key-chatgpt-connect").click();
    await expect(panel.getByTestId("own-key-chatgpt").getByRole("alert")).toContainText("email address");
    expect(service.puts).toHaveLength(1);
    await key.fill("");
    expect(service.puts).toEqual([{ provider: "openai", model: "gpt-4o-mini", apiKey: FAKE_KEY }]);
    await expect(key).toHaveValue("");
    // read back from the service, not from the success message above
    await expect(panel.getByTestId("own-ai-status")).toContainText("Using your own AI: ChatGPT (OpenAI)", { timeout: 20_000 });
    expect(service.connected()).toBe(true);
  });

  test("the ChatGPT website wizard: make the code, the check says NOT YET with the usual mistakes, then CONNECTED once the AI has used it", async ({ page, context }) => {
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    await stubConnectService(page);
    const awl = await stubWorkLinkService(page);
    await openShell(page, laptop.person.projects[0].id);

    await page.getByTestId("connect-your-ai-open").click();
    const panel = page.getByTestId("connect-your-ai-panel");
    await panel.getByTestId("connect-provider-chatgpt").getByRole("button").first().click();
    const wizard = panel.getByTestId("wizard-chatgpt");
    await expect(wizard.getByTestId("wizard-support-chatgpt")).toContainText("Depends on your plan");

    await wizard.getByTestId("wizard-make").click();
    await expect(wizard.getByTestId("wizard-code").locator("input")).toHaveValue(`${AWL}/${TOKEN}`, { timeout: 20_000 });
    expect(awl.mints).toEqual([{ days: 30, level: 1, label: "ChatGPT connection" }]);

    await wizard.getByTestId("wizard-check").click();
    await expect(wizard.getByTestId("wizard-diagnosis")).toHaveAttribute("data-state", "waiting", { timeout: 20_000 });
    await expect(wizard.getByTestId("wizard-mistakes")).toContainText("Developer mode was not switched on");

    awl.aiUsesTheCode();
    await wizard.getByTestId("wizard-check").click();
    await expect(wizard.getByTestId("wizard-diagnosis")).toHaveAttribute("data-state", "connected", { timeout: 20_000 });
    await expect(wizard.getByTestId("wizard-diagnosis")).toContainText("Connected. ChatGPT used PROJEXA");
  });

  test("offline the control says it needs internet and the shell keeps working; back online it is ready again", async ({ page, context }) => {
    const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
    await stubConnectService(page);
    await openShell(page, laptop.person.projects[0].id);
    await goOffline(laptop);
    const bar = page.getByTestId("local-shell-ai-bar");
    await expect(bar).toHaveAttribute("data-online", "0", { timeout: 30_000 });
    await expect(page.getByTestId("local-shell-ai-caption")).toContainText("Needs internet to connect");
    await expect(page.getByTestId("local-shell-home")).toBeVisible();
    await goOnline(laptop);
    await expect(bar).toHaveAttribute("data-online", "1", { timeout: 30_000 });
    await expect(page.getByTestId("local-shell-ai-caption")).toContainText("Connect ChatGPT, Claude, Gemini");
    await expect(page.getByTestId("connect-your-ai-open")).toBeEnabled();
  });

  test("a read-only role sees a plain sentence instead of the button", async ({ page, context }) => {
    const laptop = await prepareLaptop(page, context, "viewer");
    await openShell(page, laptop.person.projects[0].id);
    await expect(page.getByTestId("local-shell-ai-role-note")).toBeVisible();
    await expect(page.getByTestId("connect-your-ai-open")).toHaveCount(0);
  });
});
