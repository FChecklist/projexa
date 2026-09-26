import { test, expect, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { buildProjectFixture } from "./support/boq-fixture";
import { APP_ORIGIN, signInLocally, stubAppApis } from "./support/boq-local";

// PROJEXA-BUILD-002 WP-10, register row AW-601 (screen half) and the screens of way 2 and of the approvals list. Three runs, all in the
// Playwright project "boq-local" (playwright.boq-local.config.ts): a local PROJEXA server, a synthetic signed-in browser, and this file
// answering the /api calls of the page in the browser, so the screen is proved (what it sends, what it shows) and nothing reaches VERIDIAN.
//
//   bunx playwright test -c playwright.boq-local.config.ts e2e/upload-proposals.spec.ts
//   or, through the register's runner:  bash scripts/verify/projexa-playwright.sh e2e/upload-proposals.spec.ts
//
// WHAT THIS SPEC DOES NOT PROVE. The stub stands in for VERIDIAN's job, so "the project exists" is the stub's own state here. The
// re-read of the created project and its BOQ total from the database (AW-601's verify command, way1-zoomies.sh) is a separate run against a
// real VERIDIAN. The two halves are kept apart on purpose: a stubbed screen test must never be read as a database proof.
//
// The workbook below is 12 bytes of text, not a workbook: the screen never opens it (VERIDIAN reads it), it only hashes it and sends it.

const SHEET = Buffer.from("PK-fake-book");
const SHA = createHash("sha256").update(SHEET).digest("hex");
const PRODUCT = { id: "prod-1", name: "Villa Projects" };
const PROJECT = { id: "proj-zoomies", name: "Zoomies Dubai" };

type Seen = { method: string; url: string; body: string | null };
type Jobs = { seen: Seen[]; posts: string[] };

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const RECON = { status: "shortfall", expected: 1596280, actual: 1388480, difference: 207800, tolerance: 1, source: "reader", byArea: [{ area: "Play Area", expected: 1343445, actual: 1135645, difference: 207800, status: "shortfall" }] };
const QUESTION = { kind: "no_rate", sheet: "Table 4", row: 7, text: "Row 7 has a quantity and no rate." };
const job = (state: string, updatedAt: string, over: Record<string, unknown> = {}) => ({
  jobId: "job-1", state, fileName: "zoomies.xlsx", projectId: state === "created" ? PROJECT.id : null, questions: [], reconciliation: RECON,
  stats: { sheets: 22, rows: 343, lines: 53 }, error: null, updatedAt, ...over,
});

/** Answers the pages' own routes after stubAppApis (the route registered last is asked first). */
async function stubUploadApis(page: Page): Promise<Jobs> {
  const state = { phase: "none" as "none" | "prepared" | "creating" | "created", reads: 0 };
  const jobs: Jobs = { seen: [], posts: [] };

  await page.route("**/api/**", async (route, request) => {
    const url = new URL(request.url());
    if (url.origin !== APP_ORIGIN) return route.fallback();
    const path = url.pathname;
    const method = request.method();
    const isMine = path === "/api/organization" || path === "/api/products" || path === "/api/projects/from-document" || path === "/api/projects" || path.endsWith("/approvals");
    if (!isMine) return route.fallback();
    jobs.seen.push({ method, url: path + url.search, body: request.postData() });

    if (path === "/api/organization") return json(route, 200, { role: "owner", organization: { id: "fixture-org", name: "Fixture Builders", country: "AE" } });
    if (path === "/api/products") return json(route, 200, { products: [PRODUCT] });
    if (path === "/api/projects" && method === "GET") return json(route, 200, { projects: [{ id: "p1", name: "Tower A" }] });

    if (path === "/api/projects/from-document" && method === "POST") {
      const body = request.postData() ?? "";
      jobs.posts.push(body);
      state.phase = /name="mode"\r?\n\r?\ncreate/.test(body) ? "creating" : "prepared";
      state.reads = 0;
      return json(route, 202, { state: "received", jobId: "job-1" });
    }
    if (path === "/api/projects/from-document" && method === "GET") {
      if (url.searchParams.get("sha256") !== SHA) return json(route, 404, { error: "No such extraction job", code: null, upstreamCode: "job_not_found" });
      state.reads += 1;
      if (state.phase === "prepared") return json(route, 200, state.reads < 2 ? job("reading", "t0") : job("needs_answers", "t1", { questions: [QUESTION] }));
      if (state.phase === "creating") {
        // the first answer is still the parked one, as VERIDIAN gives it until the job has moved: the screen must read past it
        if (state.reads < 2) return json(route, 200, job("needs_answers", "t1", { questions: [QUESTION] }));
        state.phase = "created";
      }
      return json(route, 200, job("created", "t3", { questions: [QUESTION] }));
    }

    if (path === "/api/projects/p1/approvals" && method === "GET") {
      return json(route, 200, {
        projectId: "p1", count: 1,
        proposals: [{
          submissionId: "sub-1", source: "email_intelligence", functionId: "create_boq", label: "Create BOQ", note: "From the 12 Sept email", preparedById: "u1", preparedAt: "2026-09-26T08:00:00.000Z", missing: [],
          params: { projectId: "p1", title: "Revised joinery", lineItems: [{ itemCode: "J-1", description: "Vanity unit", unit: "nos", quantity: 4, rate: 1500 }] },
          approve: { action: "approve", method: "POST", path: "/x", body: { submissionId: "sub-1" } },
        }],
      });
    }
    if (path === "/api/projects/p1/approvals" && method === "POST") return json(route, 201, { approved: true, submissionId: "sub-1", boqId: "boq-9", lineItemIds: ["l1"] });
    return route.fallback();
  });
  return jobs;
}

async function setUp(page: Page, context: Parameters<typeof signInLocally>[0]) {
  const fixture = buildProjectFixture();
  const session = await signInLocally(context);
  await stubAppApis(page, fixture, session);
  return stubUploadApis(page);
}

const skipUnlessLocal = (name: string) => test.skip(name !== "boq-local", "this run is for playwright.boq-local.config.ts (a local server and a stubbed network)");

test("AW-601 (screen): pick a file, read it, see the totals and the questions, confirm once, land on the project", async ({ page, context }, testInfo) => {
  skipUnlessLocal(testInfo.project.name);
  const jobs = await setUp(page, context);

  await test.step("the form asks for a file and a product, and Read is off with the reason until both are chosen", async () => {
    await page.goto("/projects/from-file");
    await expect(page.getByTestId("doc-file")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("doc-read")).toBeDisabled();
    await expect(page.getByTestId("doc-read-reason")).toHaveText("Choose a file and a product to continue.");
  });

  await test.step("a file of the wrong type is refused in words, before any byte is sent", async () => {
    await page.getByTestId("doc-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("x") });
    await expect(page.getByTestId("doc-file-error")).toContainText("Wrong type: .png");
    expect(jobs.posts).toHaveLength(0);
  });

  await test.step("the workbook is read: totals against what the file prints, and the question, and nothing is created yet", async () => {
    await page.getByTestId("doc-file").setInputFiles({ name: "zoomies.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: SHEET });
    await expect(page.getByTestId("doc-file-error")).toHaveCount(0);
    await expect(page.getByTestId("doc-product")).toHaveValue(PRODUCT.id);
    await page.getByTestId("doc-name").fill("Zoomies Dubai");
    await page.getByTestId("doc-read").click();
    await expect(page.getByTestId("doc-parked")).toBeVisible();
    await expect(page.getByTestId("doc-stats")).toHaveText("Read 22 sheets, 343 rows, 53 BOQ lines.");
    const all = page.locator('[data-testid="doc-total-row"][data-area="all"]');
    await expect(all).toContainText("1,596,280");
    await expect(all).toContainText("1,388,480");
    await expect(all).toContainText("207,800");
    await expect(page.getByTestId("doc-question")).toContainText("Row 7 has a quantity and no rate.");
    await expect(page.getByTestId("doc-created")).toHaveCount(0);
    await expect(page.getByTestId("doc-create")).toBeDisabled();
    // the first send was a read (mode prepare) of this file, and the job was watched by the hash of the file
    expect(jobs.posts).toHaveLength(1);
    expect(jobs.posts[0]).toMatch(/name="mode"\r?\n\r?\nprepare/);
    expect(jobs.posts[0]).toMatch(/name="productId"\r?\n\r?\nprod-1/);
    expect(jobs.posts[0]).toMatch(/name="name"\r?\n\r?\nZoomies Dubai/);
    expect(jobs.seen.filter((s) => s.method === "GET" && s.url.startsWith("/api/projects/from-document")).every((s) => s.url.endsWith(`?sha256=${SHA}`))).toBe(true);
  });

  await test.step("the confirm needs both ticks, then creates: the old parked answer is read past and the project is offered", async () => {
    await page.getByTestId("doc-ack-questions").check();
    await expect(page.getByTestId("doc-create")).toBeDisabled();
    await expect(page.getByTestId("doc-create-reason")).toContainText("less than the file prints");
    await page.getByTestId("doc-ack-shortfall").check();
    await expect(page.getByTestId("doc-create")).toBeEnabled();
    await page.getByTestId("doc-create").click();
    await expect(page.getByTestId("doc-created")).toBeVisible();
    await expect(page.getByTestId("doc-open-project")).toHaveAttribute("href", `/dashboard/project?projectId=${PROJECT.id}`);
    expect(jobs.posts).toHaveLength(2);
    expect(jobs.posts[1]).toMatch(/name="mode"\r?\n\r?\ncreate/);
    expect(jobs.posts[1]).toMatch(/name="acknowledgeQuestions"\r?\n\r?\ntrue/);
    expect(jobs.posts[1]).toMatch(/name="acknowledgeShortfall"\r?\n\r?\ntrue/);
  });

  await test.step("the file's own bytes were only ever in the two multipart bodies: not in a URL, not in storage", async () => {
    for (const s of jobs.seen) expect(s.url).not.toContain("PK-fake-book");
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(stored).not.toContain("PK-fake-book");
  });
});

test("WP-10 (screen): Proposals and questions lists what was prepared, Approve writes it once, Reject is off with its reason", async ({ page, context }, testInfo) => {
  skipUnlessLocal(testInfo.project.name);
  const jobs = await setUp(page, context);
  await page.goto("/proposals");
  const card = page.getByTestId("proposal");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText("Revised joinery");
  await expect(card).toContainText("Tower A");
  await expect(card).toContainText("From the 12 Sept email");
  await expect(page.getByTestId("proposal-reject")).toBeDisabled();
  await expect(page.getByTestId("proposal-reject")).toHaveText("Reject (not available yet)");
  await page.getByTestId("proposal-approve").click();
  await expect(page.getByTestId("proposal-approved")).toContainText("1 line item written");
  await expect(page.getByTestId("proposal")).toHaveCount(0);
  const approvals = jobs.seen.filter((s) => s.method === "POST" && s.url === "/api/projects/p1/approvals");
  expect(approvals).toHaveLength(1);
  expect(JSON.parse(approvals[0].body ?? "{}")).toEqual({ submissionId: "sub-1", params: {} });
});

test("WP-10 way 2 (screen): a file attached in the chat is read by the same flow, and the project is announced in the chat", async ({ page, context }, testInfo) => {
  skipUnlessLocal(testInfo.project.name);
  const jobs = await setUp(page, context);
  await page.goto("/projects");
  const attach = page.getByTestId("chat-document-attach");
  await expect(attach).toBeVisible({ timeout: 120_000 });
  await attach.locator('input[type="file"]').setInputFiles({ name: "zoomies.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: SHEET });
  await expect(page.getByTestId("chat-doc-read")).toBeEnabled();
  await page.getByTestId("chat-doc-read").click();
  await expect(page.getByTestId("doc-parked")).toBeVisible();
  await expect(page.getByTestId("doc-question")).toContainText("Row 7 has a quantity and no rate.");
  await page.getByTestId("doc-ack-questions").check();
  await page.getByTestId("doc-ack-shortfall").check();
  await page.getByTestId("doc-create").click();
  await expect(page.getByTestId("doc-created")).toBeVisible();
  await expect(page.getByText("Project created from zoomies.xlsx")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the project" }).first()).toHaveAttribute("href", `/dashboard/project?projectId=${PROJECT.id}`);
  expect(jobs.posts).toHaveLength(2);
  expect(jobs.posts[1]).toMatch(/name="mode"\r?\n\r?\ncreate/);
});
