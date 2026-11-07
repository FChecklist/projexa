import { test, expect, type Browser, type APIRequestContext } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// WRITE-FLOW + ROLE CHECK that cleans up after itself (BOSS/owner order, 7 Nov 2026).
// Meridian test org ONLY, signed in as the seeded E2E fixture users (see e2e/users.ts), against https://projexa-ai.com or any build:
//   PLAYWRIGHT_BASE_URL=... bunx playwright test e2e/writeflow-undo-roles.spec.ts
// 1. a project manager creates one tiny BOQ, and the test RE-READS it from the API (persisted, not a success message);
// 2. a client viewer and a site engineer are REFUSED when they try to change that BOQ, and the BOQ is unchanged afterwards;
// 3. the BOQ is deleted and the test re-reads to prove it is gone (undo), so no row is left behind;
// 4. read-side scoping (project scoping rule B): a client viewer cannot list projects or read billing claims.
// Role gates are proven by the status code AND by re-reading the data, so a gate that is silently removed makes this fail.
test.describe.configure({ mode: "serial" });

const P = DEFAULT_PROJECT.id;
const TAG = `AUDIT writeflow ${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
let boqId = "";

async function as(browser: Browser, state: string): Promise<{ api: APIRequestContext; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ storageState: `playwright/.auth/${state}.json` });
  return { api: ctx.request, close: () => ctx.close() };
}

test("a project manager creates a BOQ and it is really saved (re-read from the API)", async ({ browser }) => {
  const pm = await as(browser, "finance");
  try {
    const res = await pm.api.post("/api/scope", { data: { title: `${TAG} BOQ`, projectId: P, lineItems: [{ description: `${TAG} excavation`, unit: "m3", quantity: 2, rate: 3 }] } });
    expect(res.status(), await res.text()).toBe(201);
    boqId = ((await res.json()) as { id?: string }).id ?? "";
    expect(boqId).toBeTruthy();
    const back = await pm.api.get(`/api/scope/${boqId}`);
    expect(back.status()).toBe(200);
    const detail = (await back.json()) as { lineItems?: { description: string; quantity: string }[] };
    expect(detail.lineItems?.length, "the line really persisted").toBe(1);
    expect(detail.lineItems![0].description).toContain(TAG);
  } finally { await pm.close(); }
});

for (const [state, label] of [["clientViewer", "client viewer"], ["siteSupervisor", "site engineer"]] as const) {
  test(`a ${label} cannot change or delete that BOQ, and it is unchanged afterwards`, async ({ browser }) => {
    test.skip(!boqId, "no BOQ was created");
    const who = await as(browser, state);
    const owner = await as(browser, "ceo");
    try {
      const patch = await who.api.patch(`/api/scope/${boqId}`, { data: { title: `${TAG} HACKED by ${label}` } });
      expect(patch.status(), "PATCH refused").toBe(403);
      const del = await who.api.delete(`/api/scope/${boqId}`);
      expect(del.status(), "DELETE refused").toBe(403);
      const after = await owner.api.get(`/api/scope/${boqId}`);
      expect(after.status(), "the BOQ still exists").toBe(200);
      expect(JSON.stringify(await after.json())).not.toContain("HACKED");
    } finally { await who.close(); await owner.close(); }
  });
}

test("undo: the BOQ is deleted and re-reading proves it is gone", async ({ browser }) => {
  test.skip(!boqId, "no BOQ was created");
  const pm = await as(browser, "finance");
  try {
    const del = await pm.api.delete(`/api/scope/${boqId}`);
    expect([200, 204], await del.text()).toContain(del.status());
    const gone = await pm.api.get(`/api/scope/${boqId}`);
    expect(gone.status(), "deleted BOQ is no longer readable").toBeGreaterThanOrEqual(400);
    const list = (await (await pm.api.get(`/api/scope?projectId=${P}`)).json()) as { boqs?: { id: string }[] } | { id: string }[];
    const rows = Array.isArray(list) ? list : list.boqs ?? [];
    expect(rows.some((b) => b.id === boqId), "not in the project list either").toBe(false);
  } finally { await pm.close(); }
});

test("read-side scoping: a client viewer cannot list projects or read billing claims; the owner still can", async ({ browser }) => {
  const client = await as(browser, "clientViewer");
  const owner = await as(browser, "ceo");
  try {
    for (const path of ["/api/projects", "/api/projects/overview", "/api/billing-claims", "/api/employees", "/api/accounts"]) {
      expect((await client.api.get(path)).status(), `client viewer ${path}`).toBe(403);
    }
    for (const path of ["/api/projects", "/api/employees"]) expect((await owner.api.get(path)).status(), `owner ${path}`).toBe(200);
  } finally { await client.close(); await owner.close(); }
});

// PHONE WIDTH (375 x 812, BOSS order 7 Nov): the key signed-in screens must not scroll sideways or show a crash, for the roles that use them.
for (const [state, label] of [["finance", "project manager"], ["clientViewer", "client viewer"]] as const) {
  test(`phone width: ${label} opens the key screens with no sideways scroll and no crash`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: `playwright/.auth/${state}.json`, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      for (const path of ["/dashboard", `/scope?projectId=${P}`, `/work-progress?projectId=${P}`, "/reports"]) {
        await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForTimeout(5_000);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, text: document.body.innerText.slice(0, 4000) }));
        expect(m.sw, `${label} ${path}: page is ${m.sw}px wide on a ${m.cw}px phone`).toBeLessThanOrEqual(m.cw + 2);
        expect(m.text, `${label} ${path}`).not.toMatch(/Application error|Internal Server Error|Unhandled Runtime Error/);
      }
    } finally { await ctx.close(); }
  });
}
