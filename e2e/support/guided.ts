import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { USERS, type UserKey } from "../users";
import { signInByCode, realTestCode } from "./sign-in";

// GUIDED ERRORS (docs/ERROR_GUIDE.md): shared steps of the guided-g1-*.spec.ts files. Every spec runs through the REAL screens as an E2E Meridian
// test user (e2e/users.ts) and can run against the live site:
//
//   AUDIT37_BASE_URL=https://projexa-ai.com SUPABASE_SERVICE_ROLE_KEY=... bunx playwright test -c playwright.guided.config.ts
//
// Data made here is labelled "AUDIT G1 <stamp>" and never deleted. The online screens are used (the laptop-first switch is turned OFF before the
// page loads) unless a spec says it is about the laptop screens.

export const STAMP = `${Date.now()}`.slice(-8);
export const AUDIT = `AUDIT G1 ${STAMP}`;
export const baseURL = process.env.AUDIT37_BASE_URL ?? "https://projexa-ai.com";

export type Session = { context: BrowserContext; page: Page };

/** A fresh browser profile, signed in as `who`, on the ONLINE screens (the laptop-first default is switched off before any page loads). */
export async function openOnline(browser: Browser, who: UserKey, opts: { laptop?: boolean } = {}): Promise<Session> {
  const context = await browser.newContext({ baseURL, serviceWorkers: opts.laptop ? "allow" : "block" });
  if (!opts.laptop) {
    await context.addInitScript(() => {
      try {
        localStorage.setItem("px-local-first-off", "1");
        localStorage.setItem("px-local-first", "0");
      } catch {
        /* storage blocked */
      }
    });
  }
  const page = await context.newPage();
  for (let attempt = 0; ; attempt++) {
    try {
      await signInByCode(page, USERS[who].email, { code: realTestCode, timeoutMs: 60_000 });
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      await page.waitForTimeout(5_000);
    }
  }
  return { context, page };
}

export type ProjectRef = { id: string; name: string };

/** The project the specs work in: "Meridian Heights" when the person has it, else their first project. */
export async function mainProject(page: Page): Promise<ProjectRef> {
  const res = await page.request.get("/api/projects");
  expect(res.ok(), "GET /api/projects").toBe(true);
  const { projects } = (await res.json()) as { projects: ProjectRef[] };
  const p = projects.find((x) => /meridian heights/i.test(x.name)) ?? projects[0];
  if (!p) throw new Error("this person has no project");
  return p;
}

/** An AUDIT-labelled project of its own (so a baseline or a revision made by a spec never touches the shared demo project). */
export async function makeAuditProject(page: Page, label: string): Promise<ProjectRef> {
  const name = `${AUDIT} ${label}`;
  const res = await page.request.post("/api/projects", { data: { name } });
  expect(res.status(), `POST /api/projects ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, name };
}

export type LineSeed = { description: string; unit?: string; quantity?: number; rate?: number; itemCode?: string };

/** An AUDIT-labelled BOQ made through the API (a spec that tests a later step does not retype the form). */
export async function makeAuditBoq(request: APIRequestContext, projectId: string, label: string, lines: LineSeed[] = [{ description: `${AUDIT} line`, unit: "m3", quantity: 10, rate: 5 }]): Promise<{ id: string; title: string }> {
  const title = `${AUDIT} ${label}`;
  const res = await request.post("/api/scope", {
    data: { projectId, title, lineItems: lines.map((l) => ({ description: l.description, unit: l.unit ?? "m3", quantity: l.quantity ?? 1, rate: l.rate ?? 1, ...(l.itemCode ? { itemCode: l.itemCode } : {}) })) },
  });
  expect(res.status(), `POST /api/scope ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, title };
}

// ───────────── the panel ─────────────

export const panel = (page: Page): Locator => page.getByTestId("guided-error").first();

export type PanelExpect = {
  /** The catalogue guide id (data-guide-id). */
  id?: string;
  /** A phrase the "what happened" must carry (the screen's own full sentence, or the server's words). */
  what?: RegExp | string;
  /** Title words. */
  title?: RegExp | string;
  /** The panel offers a Fix button whose "Where:" line says this. */
  where?: RegExp | string;
  /** The panel offers "Try again". */
  retry?: boolean;
};

/**
 * The panel is whole: a title, what happened, why, numbered steps (1 to 4), and (when the guide has one) the place to go. Returns the panel.
 */
export async function expectGuidedPanel(page: Page, want: PanelExpect = {}): Promise<Locator> {
  const p = panel(page);
  await expect(p, "the guided panel is on screen").toBeVisible({ timeout: 20_000 });
  await expect(p.getByTestId("guided-error-title")).not.toHaveText("");
  await expect(p.getByTestId("guided-error-what")).not.toHaveText("");
  await expect(p.getByTestId("guided-error-why")).not.toHaveText("");
  const steps = await p.getByTestId("guided-error-steps").locator("li").count();
  expect(steps, "1 to 4 numbered steps").toBeGreaterThanOrEqual(1);
  expect(steps).toBeLessThanOrEqual(4);
  {
    const txt = async (id: string) => ((await p.getByTestId(id).first().innerText().catch(() => "")) || "").split(/\s+/).join(" ").trim();
    const fix = p.getByTestId("guided-error-fix").first();
    const rec = { test: test.info().title, file: test.info().file.split("e2e").pop(), guideId: await p.getAttribute("data-guide-id"), title: await txt("guided-error-title"), what: await txt("guided-error-what"), why: await txt("guided-error-why"), where: await txt("guided-error-where"), steps: await p.getByTestId("guided-error-steps").locator("li").allInnerTexts(), fixLabel: await txt("guided-error-fix"), fixHref: await fix.getAttribute("href").catch(() => null), url: page.url() };
    (await import("node:fs")).appendFileSync("C:/ct/auditw/guided-dump.jsonl", JSON.stringify(rec) + String.fromCharCode(10));
  }
  if (want.id) await expect(p).toHaveAttribute("data-guide-id", want.id);
  if (want.title) await expect(p.getByTestId("guided-error-title")).toContainText(want.title);
  if (want.what) await expect(p.getByTestId("guided-error-what")).toContainText(want.what);
  if (want.where) await expect(p.getByTestId("guided-error-where")).toContainText(want.where);
  if (want.retry !== undefined) await expect(p.getByTestId("guided-error-retry")).toHaveCount(want.retry ? 1 : 0);
  // never a popup
  await expect(page.locator('[role="dialog"], [role="alertdialog"]')).toHaveCount(0);
  return p;
}

/** The element the Fix link must have taken the person to: outlined (data-px-highlighted) for 3 s and focused. */
export async function expectHighlighted(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector).first();
  await expect(el, `${selector} is outlined`).toHaveAttribute("data-px-highlighted", "true", { timeout: 15_000 });
}

export async function pressFix(page: Page): Promise<void> {
  await panel(page).getByTestId("guided-error-fix").click();
}

/** After a Fix trip to ANOTHER screen: the strip says where you came from, and "Back" returns to it. */
export async function backFromStrip(page: Page, label: RegExp | string): Promise<void> {
  const strip = page.getByTestId("return-strip");
  await expect(strip, "the way-back strip").toBeVisible({ timeout: 20_000 });
  {
    const strip = ((await page.getByTestId("return-strip").innerText().catch(() => "")) || "").split(/\s+/).join(" ").trim();
    (await import("node:fs")).appendFileSync("C:/ct/auditw/guided-dump.jsonl", JSON.stringify({ test: test.info().title, file: test.info().file.split("e2e").pop(), backStrip: strip, backLabel: ((await page.getByTestId("return-strip-back").innerText().catch(() => "")) || "").trim() }) + String.fromCharCode(10));
  }
  await expect(page.getByTestId("return-strip-back")).toContainText(label);
  await page.getByTestId("return-strip-back").click();
}

export const noPopup = async (page: Page): Promise<void> => {
  await expect(page.locator('[role="dialog"], [role="alertdialog"]')).toHaveCount(0);
};

/** Answers one matching request with a prepared reply (once), then lets the rest through: how a server failure is made on demand. */
export async function failOnce(context: BrowserContext | Page, urlPart: string, method: string, status: number, body: unknown): Promise<{ hits: () => number }> {
  let hits = 0;
  await context.route(
    (url) => url.pathname.includes(urlPart),
    async (route) => {
      if (route.request().method() !== method || hits > 0) return route.fallback();
      hits += 1;
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    }
  );
  return { hits: () => hits };
}
