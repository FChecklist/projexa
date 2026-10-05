import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, openLocal, outboxOps, localRows, projectId, serverRows } from "./support/real-backend";

// AUDIT-100 rows B7 (an edit made online lands in Supabase AND on a second laptop), B18 (edits made offline queue and flush when the network is back,
// re-read from the server), B28 (back online, sync resumes WITHOUT a refresh) -- against the REAL backend (playwright.audit37-real.config.ts):
// real login, real projexa-sync service, real PROJEXA Supabase, real Chromium. Two browser profiles = two laptops: A is the project manager, B the owner.
// Every assertion re-reads the PERSISTED outcome: the server's own rows (a Node-side HTTP call to the real service, independent of the browser's
// network state) and each laptop's IndexedDB copy -- never a toast.
test.describe.configure({ mode: "serial" });
test.setTimeout(1_500_000);

const STAMP = `audit100-${Date.now()}`;
const SUBJECT_1 = `B7 online RFI ${STAMP}`;
const SUBJECT_2 = `B18 offline RFI ${STAMP}`;
const ANSWER = `answered from laptop A ${STAMP}`;

let A: { context: BrowserContext; page: Page };
let B: { context: BrowserContext; page: Page };
let P: string;

test.beforeAll(async ({ browser }) => {
  A = await openLaptop(browser, "finance");
  B = await openLaptop(browser, "ceo");
  P = await projectId(A.context);
  // BREAK-TEST SWITCH (R74-RULING-03 (c)): AUDIT100_BREAK=push refuses every push of laptop A to the real service; the specs must then FAIL.
  if (process.env.AUDIT100_BREAK === "push") await A.context.route(/projexa-sync\/push/, (r) => r.abort("connectionrefused"));
});
test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
});

async function createRfiOnLaptop(page: Page, subject: string) {
  await openLocal(page, `/local/rfis/new?projectId=${P}`, "rfi-new");
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Question").fill(`Question for ${subject}`);
  await page.getByRole("button", { name: "Save RFI" }).click();
}

test("B7: an RFI made online on laptop A lands in Supabase and on laptop B", async () => {
  await createRfiOnLaptop(A.page, SUBJECT_1);
  // on laptop A at once, waiting to be sent or already sent
  await expect.poll(async () => (await localRows(A.page, "rfis", SUBJECT_1)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // the outbox empties (the real service took it) ...
  await expect.poll(async () => (await outboxOps(A.page)).length, { timeout: 90_000, message: "laptop A's outbox never emptied: the edit was not sent" }).toBe(0);
  // ... and the SERVER holds it: re-read through the real service, not the laptop's copy
  let rows: Awaited<ReturnType<typeof serverRows>> = [];
  await expect
    .poll(async () => (rows = await serverRows(A.context, P, "rfis", SUBJECT_1)).length, { timeout: 90_000, message: "the RFI is not in the server's data" })
    .toBe(1);
  expect(rows[0].data.subject).toBe(SUBJECT_1);
  // laptop B gets it with no click: its own copy ends up holding the SERVER's row (not a pending local one)
  await expect
    .poll(async () => (await localRows(B.page, "rfis", SUBJECT_1)).filter((r) => !r.dirty).length, { timeout: 600_000, message: "laptop B never received the RFI" })
    .toBe(1);
});

test("B7: an edit (an answer) made on laptop A lands in Supabase and on laptop B", async () => {
  const [row] = await serverRows(A.context, P, "rfis", SUBJECT_1);
  const before = row.version ?? 0;
  await openLocal(A.page, `/local/rfis/${row.id}?projectId=${P}`, "rfi-object");
  await A.page.getByLabel("Answer", { exact: true }).fill(ANSWER);
  await A.page.getByTestId("rfi-answer-form").getByRole("button").first().click();
  await expect.poll(async () => (await outboxOps(A.page)).length, { timeout: 90_000 }).toBe(0);
  await expect
    .poll(async () => (await serverRows(A.context, P, "rfis", SUBJECT_1))[0]?.data.answer, { timeout: 90_000, message: "the answer is not in the server's data" })
    .toBe(ANSWER);
  const after = (await serverRows(A.context, P, "rfis", SUBJECT_1))[0];
  expect(after.version ?? 0).toBeGreaterThan(before);
  await expect
    .poll(async () => (await localRows(B.page, "rfis", SUBJECT_1))[0]?.data?.answer, { timeout: 600_000, message: "laptop B never received the answer" })
    .toBe(ANSWER);
});

test("B18 + B28: made offline it waits and the server has nothing; back online it is sent with NO refresh, once, and read back from the server", async () => {
  await openLocal(A.page, `/local/rfis?projectId=${P}`, "rfis-list");
  await A.context.setOffline(true);
  await createRfiOnLaptop(A.page, SUBJECT_2);
  // kept on the laptop, queued
  await expect.poll(async () => (await outboxOps(A.page)).filter((o) => o.functionId === "create_rfi").length, { timeout: 30_000 }).toBe(1);
  expect(await localRows(A.page, "rfis", SUBJECT_2)).toHaveLength(1);
  // the server (read from Node, outside the browser's cut network) has NOT got it yet
  await A.page.waitForTimeout(8_000);
  expect(await serverRows(A.context, P, "rfis", SUBJECT_2), "the server got an edit while the laptop was offline").toHaveLength(0);
  // network back: no reload, no navigation, no click -- the page's own connectivity logic must resume the sync (B28)
  const urlBefore = A.page.url();
  await A.context.setOffline(false);
  await expect.poll(async () => (await outboxOps(A.page)).length, { timeout: 120_000, message: "back online the outbox never flushed by itself" }).toBe(0);
  expect(A.page.url()).toBe(urlBefore);
  let rows: Awaited<ReturnType<typeof serverRows>> = [];
  await expect.poll(async () => (rows = await serverRows(A.context, P, "rfis", SUBJECT_2)).length, { timeout: 60_000 }).toBe(1);
  expect(rows[0].data.subject).toBe(SUBJECT_2);
  // exactly once: a later focus/online pass does not create a second one
  await A.page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await A.page.waitForTimeout(5_000);
  expect(await serverRows(A.context, P, "rfis", SUBJECT_2)).toHaveLength(1);
  // and laptop B (which was online all along) has the server's row
  await expect
    .poll(async () => (await localRows(B.page, "rfis", SUBJECT_2)).filter((r) => !r.dirty).length, { timeout: 600_000, message: "laptop B never received the RFI sent after the reconnect" })
    .toBe(1);
});
