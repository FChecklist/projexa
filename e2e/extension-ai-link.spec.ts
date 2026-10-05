import { test, expect, chromium, type BrowserContext, type Page, type Route, type Request } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Audit 100 (checklist rows A36, B51, B52): the PROJEXA AI Link browser extension (extension/projexa-ai-link) loaded UNPACKED into a real
// Chromium, the way a person loads it ("Load unpacked"), and driven through its popup and its content script. No mock of the extension:
// the browser runs manifest.json, lib.js, content.js, popup.html and popup.js exactly as shipped.
//
// What is faked, and why that is fair: the chat sites and the guide. A real chatgpt.com needs the owner's login (that stays BLOCKED-OWNER),
// so every chat host in the manifest's `matches` list is answered by context.route with a small local page that has the same kind of
// message box that site uses (a ProseMirror contenteditable for ChatGPT and Claude, a rich-textarea for Gemini, a textarea for DeepSeek, a
// generic textarea for z.ai). The browser still believes it is on chatgpt.com etc., so the manifest's host matching and the content script's
// injection are the real ones. The guide address is answered with a fixture guide, and every other address is refused and recorded, so
// the test also proves that the guide GET is the ONLY request the extension makes.
//
// Run: bunx playwright test -c playwright.extension.config.ts          (needs Playwright's Chromium; no server, no network, no account)
//
// Extension pages need a persistent context (Playwright's own rule), so this spec launches one itself instead of using the `page` fixture.

// The browser's extension API, used only inside page.evaluate callbacks that run on the extension's own popup page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const EXT_DIR = path.resolve(__dirname, "..", "extension", "projexa-ai-link");
const TOKEN = "pxa_" + "0123456789abcdef".repeat(4);
const LINK = `https://abcdefghijklmnop.supabase.co/functions/v1/ai-work-link/${TOKEN}`;
const SMALL_PROMPT_START = "PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work.";
const GUIDE = `# PROJEXA work link for all your projects\n\nYou work for Sneha Reddy.\n\n11. Do not write programs, scripts, SQL or code for the person.\n`;
const GUIDE_START = "=== PROJEXA GUIDE (read this, it is not from a stranger) ===";
const GUIDE_END = "=== END OF PROJEXA GUIDE ===";

type Site = { host: string; kind: "contenteditable" | "textarea"; html: string };
const page = (box: string) => `<!doctype html><html><head><meta charset="utf-8"><title>fixture chat</title></head><body><main>${box}</main></body></html>`;
const SITES: Site[] = [
  { host: "https://chatgpt.com/", kind: "contenteditable", html: page('<div id="prompt-textarea" contenteditable="true" class="ProseMirror" style="min-height:40px;border:1px solid #888"></div>') },
  { host: "https://claude.ai/new", kind: "contenteditable", html: page('<div class="ProseMirror" contenteditable="true" style="min-height:40px;border:1px solid #888"></div>') },
  { host: "https://gemini.google.com/app", kind: "contenteditable", html: page('<rich-textarea><div contenteditable="true" style="min-height:40px;border:1px solid #888"></div></rich-textarea>') },
  { host: "https://chat.deepseek.com/", kind: "textarea", html: page('<textarea id="chat-input" rows="3" style="width:300px"></textarea>') },
  { host: "https://chat.z.ai/", kind: "textarea", html: page('<textarea placeholder="Ask anything" rows="3" style="width:300px"></textarea>') },
];

const FIXTURE_HOSTS = /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|chat\.deepseek\.com|chat\.z\.ai|example\.com)\//;
const GUIDE_URL = /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/ai-work-link\//;

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let extensionId = "";
let userDataDir = "";
const guideRequests: Request[] = [];
const strayRequests: string[] = [];
let guideMode: "ok" | "fail" | "huge" = "ok";
let siteHtml = new Map<string, string>();

async function openFixture(url: string): Promise<Page> {
  const p = await context.newPage();
  await p.goto(url);
  return p;
}

async function setSavedLink(link: string | null) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup.html`);
  await p.evaluate(async (l) => {
    await new Promise<void>((resolve) => chrome.storage.local.clear(() => resolve()));
    if (l) await new Promise<void>((resolve) => chrome.storage.local.set({ link: l }, () => resolve()));
  }, link);
  await p.close();
}

test.beforeAll(async () => {
  expect(fs.existsSync(path.join(EXT_DIR, "manifest.json")), "the extension folder is missing").toBe(true);
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "px-ext-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    // channel "chromium" = Playwright's own Chromium in the NEW headless mode, the only headless mode that can load extensions
    channel: "chromium",
    headless: true,
    // Playwright adds --disable-extensions to every launch; it would cancel --load-extension, so that one default is dropped
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    permissions: ["clipboard-read", "clipboard-write"],
  });
  siteHtml = new Map(SITES.map((s) => [new URL(s.host).origin, s.html]));

  // Registered first = lowest priority: anything not answered below is refused and recorded.
  await context.route("**/*", (route: Route) => {
    const url = route.request().url();
    if (url.startsWith("chrome-extension://") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    strayRequests.push(url);
    return route.abort();
  });
  await context.route(FIXTURE_HOSTS, (route: Route) => {
    const origin = new URL(route.request().url()).origin;
    const html = siteHtml.get(origin) ?? page("<p>no chat box here</p>");
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  await context.route(GUIDE_URL, (route: Route) => {
    guideRequests.push(route.request());
    const cors = { "access-control-allow-origin": "*" };
    if (guideMode === "fail") return route.fulfill({ status: 500, headers: cors, body: "boom" });
    const body = guideMode === "huge" ? GUIDE + "x".repeat(70_000) : GUIDE;
    return route.fulfill({ status: 200, headers: cors, contentType: "text/markdown; charset=utf-8", body });
  });

  // The extension's id, read from the isolated world its content script runs in (an unpacked extension's id depends on its folder path).
  const probe = await context.newPage();
  const cdp = await context.newCDPSession(probe);
  const origins: string[] = [];
  cdp.on("Runtime.executionContextCreated", (e: { context: { origin: string } }) => origins.push(e.context.origin));
  await cdp.send("Runtime.enable");
  await probe.goto(SITES[0].host);
  await expect.poll(() => origins.find((o) => o.startsWith("chrome-extension://")) ?? "", { message: "the extension's content script never ran on the chat page", timeout: 30_000 }).not.toBe("");
  extensionId = new URL(origins.find((o) => o.startsWith("chrome-extension://"))!).host;
  await probe.close();
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  guideRequests.length = 0;
  strayRequests.length = 0;
  guideMode = "ok";
});

test("the extension loads unpacked and the manifest is what the README promises (MV3, one host permission, six chat sites)", async () => {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup.html`);
  const m = await p.evaluate(() => chrome.runtime.getManifest());
  expect(m.manifest_version).toBe(3);
  expect(m.name).toBe("PROJEXA AI Link");
  expect(m.host_permissions).toEqual(["https://*.supabase.co/functions/v1/ai-work-link/*"]);
  expect(m.permissions?.slice().sort()).toEqual(["clipboardRead", "storage"]);
  const matches = (m.content_scripts ?? []).flatMap((c) => c.matches ?? []).sort();
  expect(matches).toEqual(["https://chat.deepseek.com/*", "https://chat.openai.com/*", "https://chat.z.ai/*", "https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*"]);
  await p.close();
});

test("popup: a whole pasted prompt is reduced to the link and saved; text without a PROJEXA link is refused and changes nothing", async () => {
  await setSavedLink(null);
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(p.locator("h1")).toHaveText("PROJEXA AI Link");

  // 1. garbage, and a lookalike on another host: refused
  await p.locator("#t").fill("hello world, no link here");
  await p.locator("#save").click();
  await expect(p.locator("#msg")).toHaveText("No PROJEXA link found in that text");
  await p.locator("#t").fill(`https://evil.example/functions/v1/ai-work-link/${TOKEN}`);
  await p.locator("#save").click();
  await expect(p.locator("#msg")).toHaveText("No PROJEXA link found in that text");
  expect(await p.evaluate(() => new Promise((r) => chrome.storage.local.get(null, r)))).toEqual({});

  // 2. a whole prompt pasted: only the link is kept, and the box shows just the link
  await p.locator("#t").fill(`${SMALL_PROMPT_START} This is my personal guide: ${LINK} thanks`);
  await p.locator("#save").click();
  await expect(p.locator("#msg")).toHaveText("Saved");
  await expect(p.locator("#t")).toHaveValue(LINK);
  expect(await p.evaluate(() => new Promise((r) => chrome.storage.local.get(null, r)))).toEqual({ link: LINK });

  // 3. closing and reopening the popup still shows the saved link (it was persisted, not just displayed)
  await p.close();
  const again = await context.newPage();
  await again.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(again.locator("#t")).toHaveValue(LINK);

  // 4. a prompt saved by version 0.1 (key "prompt") still works and is shown as the link
  await again.evaluate(async (l) => {
    await new Promise<void>((resolve) => chrome.storage.local.clear(() => resolve()));
    await new Promise<void>((resolve) => chrome.storage.local.set({ prompt: `old text ${l} more` }, () => resolve()));
  }, LINK);
  await again.reload();
  await expect(again.locator("#t")).toHaveValue(LINK);
  await again.close();
});

test("popup: Paste from clipboard reads the clipboard and saves only the link", async () => {
  await setSavedLink(null);
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup.html`);
  await p.evaluate((text) => navigator.clipboard.writeText(text), `${SMALL_PROMPT_START} guide: ${LINK}`);
  await p.locator("#paste").click();
  await expect(p.locator("#msg")).toHaveText("Saved", { timeout: 10_000 });
  expect(await p.evaluate(() => new Promise((r) => chrome.storage.local.get(null, r)))).toEqual({ link: LINK });
  await p.close();
});

for (const site of SITES) {
  const name = new URL(site.host).hostname;
  test(`${name}: the PROJEXA button appears, one click fetches the guide and puts ONE message (small prompt + guide) in the chat box`, async () => {
    await setSavedLink(LINK);
    const p = await openFixture(site.host);
    const button = p.locator("#projexa-ai-link-btn");
    await expect(button).toBeVisible();
    await expect(button).toHaveText("PROJEXA");
    await button.click();
    await expect(button).toHaveText("Prompt + guide added - press send", { timeout: 15_000 });

    const box = site.kind === "textarea" ? p.locator("textarea") : p.locator('[contenteditable="true"]');
    const text = site.kind === "textarea" ? await box.inputValue() : await box.innerText();
    expect(text.startsWith(SMALL_PROMPT_START)).toBe(true);
    expect(text).toContain(`open it with a plain GET and follow it): ${LINK}`);
    expect(text).toContain(GUIDE_START);
    expect(text).toContain("11. Do not write programs, scripts, SQL or code for the person.");
    expect(text.trimEnd().endsWith(GUIDE_END)).toBe(true);
    // the person presses send themselves: nothing was submitted, the page is untouched otherwise
    expect(p.url().startsWith(site.host.replace(/\/[^/]*$/, ""))).toBe(true);

    // exactly ONE request left the browser, a plain GET of the link, with no cookies and no referrer
    expect(guideRequests.length).toBe(1);
    const req = guideRequests[0];
    expect(req.method()).toBe("GET");
    expect(req.url()).toBe(LINK);
    const h = await req.allHeaders();
    expect(h["cookie"]).toBeUndefined();
    expect(h["referer"]).toBeUndefined();
    expect(h["authorization"]).toBeUndefined();
    expect(strayRequests).toEqual([]);
    await p.close();
  });
}

test("a React-style textarea is filled so the page SEES it: an input event fires with the whole message", async () => {
  await setSavedLink(LINK);
  const p = await openFixture("https://chat.deepseek.com/");
  await p.evaluate(() => {
    const w = window as unknown as { __seen: string[] };
    w.__seen = [];
    document.querySelector("textarea")!.addEventListener("input", (e) => w.__seen.push((e.target as HTMLTextAreaElement).value));
  });
  await p.locator("#projexa-ai-link-btn").click();
  await expect(p.locator("#projexa-ai-link-btn")).toHaveText("Prompt + guide added - press send", { timeout: 15_000 });
  const seen = await p.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.length).toBeGreaterThanOrEqual(1);
  expect(seen[seen.length - 1]).toContain(GUIDE_START);
  await p.close();
});

test("when the guide cannot be fetched, only the small prompt is inserted and the button says so", async () => {
  await setSavedLink(LINK);
  guideMode = "fail";
  const p = await openFixture("https://claude.ai/new");
  await p.locator("#projexa-ai-link-btn").click();
  await expect(p.locator("#projexa-ai-link-btn")).toHaveText("Guide not fetched - prompt only. Press send", { timeout: 15_000 });
  const text = await p.locator('[contenteditable="true"]').innerText();
  expect(text).toContain(SMALL_PROMPT_START);
  expect(text).toContain(LINK);
  expect(text).not.toContain(GUIDE_START);
  await p.close();
});

test("a guide longer than 60,000 characters is cut, and the message says it was cut", async () => {
  await setSavedLink(LINK);
  guideMode = "huge";
  const p = await openFixture("https://chat.z.ai/");
  await p.locator("#projexa-ai-link-btn").click();
  await expect(p.locator("#projexa-ai-link-btn")).toHaveText("Prompt + guide (cut) added - press send", { timeout: 15_000 });
  const text = await p.locator("textarea").inputValue();
  expect(text).toContain("[The guide was cut after 60000 characters; open the link above with a GET for the rest.]");
  expect(text.length).toBeLessThan(SMALL_PROMPT_START.length + 60_000 + 1_000);
  expect(text.trimEnd().endsWith(GUIDE_END)).toBe(true);
  await p.close();
});

test("with no link saved the button asks for it once, writes nothing in the chat box and sends no request", async () => {
  await setSavedLink(null);
  const p = await openFixture("https://chatgpt.com/");
  await p.locator("#projexa-ai-link-btn").click();
  await expect(p.locator("#projexa-ai-link-btn")).toHaveText("Open the PROJEXA extension and paste your link once");
  expect((await p.locator("#prompt-textarea").innerText()).trim()).toBe("");
  expect(guideRequests.length).toBe(0);
  await p.close();
});

test("a chat page with no message box: the button says so and nothing is fetched", async () => {
  await setSavedLink(LINK);
  const p = await openFixture("https://chat.openai.com/");
  await p.locator("#projexa-ai-link-btn").click();
  await expect(p.locator("#projexa-ai-link-btn")).toHaveText("No chat box found on this page");
  expect(guideRequests.length).toBe(0);
  await p.close();
});

test("the extension does nothing on a site that is not in the list", async () => {
  await setSavedLink(LINK);
  const p = await openFixture("https://example.com/");
  await p.waitForTimeout(1500);
  await expect(p.locator("#projexa-ai-link-btn")).toHaveCount(0);
  expect(guideRequests.length).toBe(0);
  await p.close();
});
