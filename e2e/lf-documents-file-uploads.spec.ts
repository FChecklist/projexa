import { test, expect, type Page } from "@playwright/test";
import { goOffline, goOnline, noCrash, openLocal, prepareLaptop, expectCleanConsole, type Prepared } from "./support/lf-documents-prepare";
import { PROJECT_ID, readOutbox, dayFromToday, type Net } from "./support/lf-documents-stub";

// LOCAL-FIRST, G-15: a permit, a drawing and a document are added WITH their file while the network is OFF. The file and what was typed stay on
// the laptop; once the connection is back the file goes to the signed address (POST projexa-api /uploads/sign, then PUT, no Authorization on
// the PUT) and ONLY THEN is the record sent -- exactly once -- as the registry's create_permit / create_drawing / create_document carrying the
// public externalUrl the server handed out. The upload service itself is answered inside the browser (page.route); nothing leaves this laptop.

const API = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api";
const STORAGE = "https://files.example.invalid/put";
const PUBLIC_URL = "https://files.example.invalid/public";

/** Types like a person: one real keystroke at a time. */
async function type(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true });
  await box.click();
  await box.pressSequentially(text, { delay: 15 });
  await expect(box).toHaveValue(text);
}

type Stub = { signs: Array<Record<string, unknown>>; puts: Array<{ headers: Record<string, string>; size: number }> };

/** The upload service: /uploads/sign answers with a fresh address per file; the address takes the PUT. Honours the network switch. */
async function stubUploads(page: Page, net: Net, token: string): Promise<Stub> {
  const s: Stub = { signs: [], puts: [] };
  const cors = (origin?: string) => ({
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    vary: "Origin",
  });
  await page.route(`${API}/uploads/sign`, async (route, request) => {
    const origin = request.headers()["origin"];
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(origin) });
    if (net.mode !== "up") return route.abort("internetdisconnected");
    expect(request.headers()["authorization"], "sign must carry the person's own session token").toBe(`Bearer ${token}`);
    const body = request.postDataJSON() as Record<string, unknown>;
    s.signs.push(body);
    const n = s.signs.length;
    return route.fulfill({
      status: 200,
      headers: { ...cors(origin), "content-type": "application/json" },
      body: JSON.stringify({ uploadUrl: `${STORAGE}/${n}`, method: "PUT", headers: { "content-type": String(body.contentType) }, externalUrl: `${PUBLIC_URL}/${n}`, maxBytes: 52_428_800 }),
    });
  });
  await page.route(`${STORAGE}/**`, async (route, request) => {
    const origin = request.headers()["origin"];
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(origin) });
    if (net.mode !== "up") return route.abort("internetdisconnected");
    s.puts.push({ headers: request.headers(), size: request.postDataBuffer()?.length ?? 0 });
    return route.fulfill({ status: 200, headers: cors(origin), body: "" });
  });
  return s;
}

const PDF = { name: "fire-noc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 permit scan for the offline upload test\n") };

type Laptop = Prepared & { up: Stub };

async function laptop(page: Page, context: import("@playwright/test").BrowserContext): Promise<Laptop> {
  const p = await prepareLaptop(page, context, "member");
  const up = await stubUploads(page, p.net, p.session.accessToken);
  await goOffline(context, p);
  p.console.errors.length = 0;
  p.console.pageErrors.length = 0;
  return { ...p, up };
}

async function sentOnce(page: Page, l: Laptop, functionId: string) {
  await expect.poll(() => l.sync.pushed.length, { timeout: 60_000, message: `the offline ${functionId} was never sent` }).toBe(1);
  await expect.poll(() => readOutbox(page, l.session.userId), { message: "the sent op is still in the outbox" }).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(2_000);
  expect(l.sync.pushed, "the same record was sent twice").toHaveLength(1);
  expect(l.up.puts, "the file was uploaded more than once").toHaveLength(1);
  expect(l.sync.pushed[0].function_id).toBe(functionId);
  return l.sync.pushed[0];
}

test("permit with its file: kept offline, nothing sent, then file uploaded once and create_permit sent once with externalUrl", async ({ page, context }) => {
  const l = await laptop(page, context);

  await test.step("offline: fill the form with real keystrokes and choose the file", async () => {
    await openLocal(page, "/permits/new");
    await type(page, "Name", "Fire NOC");
    await type(page, "Permit number", "FN-2291");
    await type(page, "Issued by", "City Fire Dept");
    await page.getByLabel("Expiry date").fill(dayFromToday(90));
    await page.getByLabel("File").setInputFiles(PDF);
    await page.getByRole("button", { name: "Save permit" }).click();
    await expect(page.getByTestId("save-note")).toHaveText("Saved on this laptop. The file will be sent when you are connected, and then the record is added.");
    expect(l.up.signs, "nothing may be sent while offline").toHaveLength(0);
    expect(l.sync.pushed).toHaveLength(0);
    await page.reload();
    await openLocal(page, "/permits/new");
    await noCrash(page); expectCleanConsole(l.console);
  });

  await test.step("online: signed once, PUT once without Authorization, then create_permit once carrying the public address", async () => {
    await goOnline(context, l); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const op = await sentOnce(page, l, "create_permit");
    expect(l.up.signs).toHaveLength(1);
    expect(l.up.signs[0]).toMatchObject({ kind: "permit", projectId: PROJECT_ID, fileName: "fire-noc.pdf", contentType: "application/pdf", size: PDF.buffer.length });
    expect(l.up.puts[0].headers["authorization"], "the signed address carries its own token").toBeUndefined();
    expect(l.up.puts[0].size).toBe(PDF.buffer.length);
    expect(op.params).toMatchObject({ projectId: PROJECT_ID, name: "Fire NOC", permitNumber: "FN-2291", permitAuthority: "City Fire Dept", externalUrl: `${PUBLIC_URL}/1` });
    await noCrash(page); expectCleanConsole(l.console);
  });
});

test("drawing with its file: sent once as create_drawing with the typed fields and externalUrl", async ({ page, context }) => {
  const l = await laptop(page, context);
  await openLocal(page, "/drawings/new");
  await type(page, "Name", "Level 2 lighting plan");
  await type(page, "Drawing number", "E-201");
  await type(page, "Revision", "B");
  await page.getByLabel("File").setInputFiles({ ...PDF, name: "e-201.pdf" });
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(page.getByTestId("save-note")).toHaveAttribute("data-ok", "1");
  expect(l.up.signs).toHaveLength(0);
  await goOnline(context, l); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const op = await sentOnce(page, l, "create_drawing");
  expect(l.up.signs[0]).toMatchObject({ kind: "drawing", projectId: PROJECT_ID, fileName: "e-201.pdf" });
  expect(op.params).toMatchObject({ projectId: PROJECT_ID, name: "Level 2 lighting plan", drawingNo: "E-201", rev: "B", externalUrl: `${PUBLIC_URL}/1` });
  await noCrash(page); expectCleanConsole(l.console);
});

test("document with its file: organisation-wide (no projectId in the sign request or the record), sent once as create_document", async ({ page, context }) => {
  const l = await laptop(page, context);
  await openLocal(page, "/documents/upload");
  await type(page, "Name", "Contractor insurance");
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("File").setInputFiles({ ...PDF, name: "insurance.pdf" });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByTestId("save-note")).toHaveAttribute("data-ok", "1");
  expect(l.up.signs).toHaveLength(0);
  await goOnline(context, l); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const op = await sentOnce(page, l, "create_document");
  expect(l.up.signs[0]).toMatchObject({ kind: "document", fileName: "insurance.pdf" });
  expect(l.up.signs[0]).not.toHaveProperty("projectId");
  expect(op.params).toMatchObject({ name: "Contractor insurance", externalUrl: `${PUBLIC_URL}/1` });
  expect(op.params).not.toHaveProperty("projectId");
  await noCrash(page); expectCleanConsole(l.console);
});
